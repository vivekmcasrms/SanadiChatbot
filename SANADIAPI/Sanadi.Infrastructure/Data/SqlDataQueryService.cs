using System.Globalization;
using System.Text.Json;
using Dapper;
using Sanadi.Application.Data;
using Sanadi.Application.Realtime;
using Sanadi.Application.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Data;

public sealed class SqlDataQueryService(
    ISqlConnectionFactory connections,
    SchemaCatalog catalog,
    IPermissionService permissions,
    IRealtimePublisher realtime) : IDataQueryService
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = null,
        DictionaryKeyPolicy = null
    };

    public async Task<DataQueryResult> ExecuteAsync(DataQueryRequest request, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!user.IsAuthenticated) throw new UnauthorizedException();
        // Raw email queues and provider settings are server/admin resources. A browser
        // must not fabricate a delivery that would borrow another actor's delegated grant.
        var emailTable = request.Table.ToLowerInvariant();
        var emailAdmin = user.IsServiceRole || user.HasRole(AppRoles.SystemAdmin) || user.HasRole("integration_admin");
        if (!emailAdmin && (emailTable == "applicationsettings" ||
            (request.Method.ToUpperInvariant() is not ("GET" or "HEAD") &&
             emailTable is "notification_deliveries" or "email_templates" or "notification_settings")))
            throw new ForbiddenException();
        var (schema, table) = await catalog.ResolveTableAsync(request.Table, cancellationToken);
        IdentifierGuard.Table(table);

        return request.Method.ToUpperInvariant() switch
        {
            "GET" or "HEAD" => await QueryAsync(schema, table, request, user, cancellationToken),
            "POST" => await MutateAsync(schema, table, request, user, isUpdate: false, isDelete: false, cancellationToken),
            "PATCH" => await MutateAsync(schema, table, request, user, isUpdate: true, isDelete: false, cancellationToken),
            "DELETE" => await MutateAsync(schema, table, request, user, isUpdate: false, isDelete: true, cancellationToken),
            _ => throw new SanadiException("Unsupported method.")
        };
    }

    private async Task<DataQueryResult> QueryAsync(string schema, string table, DataQueryRequest request, ICurrentUser user, CancellationToken cancellationToken)
    {
        var columns = await catalog.GetColumnsAsync(schema, table, cancellationToken);
        // PostgREST keeps FK columns available for embeds even when omitted from select=.
        var selectCols = request.Select.ToList();
        if (!selectCols.Contains("*", StringComparer.OrdinalIgnoreCase))
        {
            var fks = await catalog.GetForeignKeysAsync(cancellationToken);
            foreach (var hint in EnumerateEmbedHints(request.Embeds))
            {
                if (!selectCols.Contains(hint, StringComparer.OrdinalIgnoreCase))
                    selectCols.Add(hint);
            }
            // Many-side embeds join on this table's referenced PK (usually id).
            foreach (var embed in request.Embeds)
            {
                var fk = fks.FirstOrDefault(x =>
                    x.RefTable.Equals(table, StringComparison.OrdinalIgnoreCase)
                    && x.Table.Equals(embed.Alias, StringComparison.OrdinalIgnoreCase));
                if (fk is null) continue;
                if (!selectCols.Contains(fk.RefColumn, StringComparer.OrdinalIgnoreCase))
                    selectCols.Add(fk.RefColumn);
            }
        }
        var selected = SelectColumns(selectCols, columns);
        var filters = await BuildFiltersAsync(table, request, cancellationToken);
        var scope = await RowSecurityAsync(schema, table, user, cancellationToken);
        var args = new
        {
            schemaName = schema, tableName = table,
            columns = JsonSerializer.Serialize(selected),
            filters = JsonSerializer.Serialize(filters),
            scope = JsonSerializer.Serialize(scope), userId = user.UserId,
            order = JsonSerializer.Serialize(request.Order.Where(o => columns.Any(c => c.Column.Equals(o.Column, StringComparison.OrdinalIgnoreCase)))),
            limit = request.Limit, offset = request.Offset
        };
        await using var conn = connections.Create();
        int? count = null;
        if (request.CountExact)
        {
            var countArgs = new DynamicParameters(args);
            countArgs.Add("countOnly", true);
            count = await conn.ExecuteScalarAsync<int>(DbProc.Call("usp_Data_Select", countArgs, cancellationToken));
        }
        if (request.HeadOnly)
            return new DataQueryResult { Data = Array.Empty<object>(), Count = count };

        var rows = (await conn.QueryAsync(DbProc.Call("usp_Data_Select", args, cancellationToken)))
            .Select(ToDict).ToList();

        if (request.Embeds.Count > 0 && rows.Count > 0)
            await AttachEmbedsAsync(schema, table, request.Embeds, rows, user, cancellationToken);

        object data = request.SingleObject
            ? rows.Count switch
            {
                0 => throw new NotFoundException(),
                1 => rows[0],
                _ => throw new SanadiException("Multiple rows returned for a single-object query.", 406, "PGRST116")
            }
            : rows;
        return new DataQueryResult { Data = data, Count = count };
    }

    private async Task<DataQueryResult> MutateAsync(
        string schema, string table, DataQueryRequest request, ICurrentUser user,
        bool isUpdate, bool isDelete, CancellationToken cancellationToken)
    {
        var columns = await catalog.GetColumnsAsync(schema, table, cancellationToken);
        var names = columns.Select(c => c.Column).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var filters = await BuildFiltersAsync(table, request, cancellationToken);
        var scope = await RowSecurityAsync(schema, table, user, cancellationToken);
        var values = new Dictionary<string, object?>();
        if (!isDelete)
        {
            var payload = NormalizePayload(request.Payload);
            if (payload.Count == 0 && !isUpdate) throw new SanadiException("Empty payload.");
            if (!isUpdate)
                return await InsertOrUpsertAsync(schema, table, request, payload, names, cancellationToken);
            values = payload[0].Where(kv => names.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => ToDb(kv.Value));
            if (values.Count == 0) throw new SanadiException("No updatable columns.");
        }
        await using var c2 = connections.Create();
        IEnumerable<dynamic> result = await c2.QueryAsync(DbProc.Call("usp_Data_Write", new
        {
            schemaName = schema, tableName = table,
            operation = isDelete ? "delete" : "update",
            columns = JsonSerializer.Serialize(SelectColumns(request.Select, columns)),
            values = SerializeValues(values), filters = JsonSerializer.Serialize(filters),
            scope = JsonSerializer.Serialize(scope), userId = user.UserId,
            returnRows = request.PreferRepresentation
        }, cancellationToken));
        var list = result.Select(ToDict).ToList();
        if (list.Count > 0)
            await realtime.PublishTableChangeAsync(table, isDelete ? "DELETE" : "UPDATE", list[0], cancellationToken);
        object outData = request.SingleObject ? list.FirstOrDefault() ?? new Dictionary<string, object?>() : list;
        return new DataQueryResult { Data = outData, Count = list.Count };
    }

    private async Task<DataQueryResult> InsertOrUpsertAsync(
        string schema, string table, DataQueryRequest request,
        List<Dictionary<string, object?>> payload, HashSet<string> names,
        CancellationToken cancellationToken)
    {
        var conflict = (request.OnConflict ?? []).Where(names.Contains).ToList();
        if (request.Upsert && conflict.Count == 0)
            conflict = (await catalog.GetPrimaryKeyAsync(schema, table, cancellationToken)).Where(names.Contains).ToList();

        var inserted = new List<IDictionary<string, object?>>();
        await using var conn = connections.Create();
        await conn.OpenAsync(cancellationToken);
        foreach (var row in payload)
        {
            var cols = row.Keys.Where(names.Contains).ToList();
            if (cols.Count == 0) continue;

            if (request.Upsert && conflict.Count > 0 && conflict.All(c => row.ContainsKey(c) && row[c] is not null))
            {
                var filters = conflict.Select(c => new DataFilter(IdentifierGuard.Column(c), "eq", ToDb(row[c]))).ToArray();
                var existing = (await conn.QueryAsync(DbProc.Call("usp_Data_Select", new
                {
                    schemaName = schema, tableName = table, columns = "[\"*\"]",
                    filters = JsonSerializer.Serialize(filters)
                }, cancellationToken))).Select(ToDict).ToList();
                if (existing.Count > 0)
                {
                    if (request.IgnoreDuplicates)
                    {
                        inserted.AddRange(existing);
                        continue;
                    }
                    var updates = cols.Where(c => !conflict.Contains(c, StringComparer.OrdinalIgnoreCase))
                        .ToDictionary(c => c, c => ToDb(row[c]));
                    if (updates.Count > 0)
                    {
                        var updated = (await conn.QueryAsync(DbProc.Call("usp_Data_Write", new
                        {
                            schemaName = schema, tableName = table, operation = "updateExisting",
                            values = SerializeValues(updates), filters = JsonSerializer.Serialize(filters), returnRows = true
                        }, cancellationToken))).Select(ToDict).ToList();
                        inserted.AddRange(updated.Count > 0 ? updated : existing);
                    }
                    else inserted.AddRange(existing);
                    continue;
                }
            }

            var values = cols.ToDictionary(c => c, c => ToDb(row[c]));
            var created = (await conn.QueryAsync(DbProc.Call("usp_Data_Write", new
            {
                schemaName = schema, tableName = table, operation = "insert",
                values = SerializeValues(values), returnRows = true
            }, cancellationToken))).Select(ToDict).ToList();
            inserted.AddRange(created);
        }
        if (inserted.Count > 0)
            await realtime.PublishTableChangeAsync(table, "INSERT", inserted[0], cancellationToken);
        object data = request.SingleObject || inserted.Count == 1
            ? inserted.FirstOrDefault() ?? new Dictionary<string, object?>()
            : inserted;
        return new DataQueryResult { Data = data, Count = inserted.Count };
    }

    private sealed record DataFilter(string Column, string Operator, object? Value,
        bool Negated = false, int Group = 0, string? Relation = null, string? ForeignColumn = null, string? LocalColumn = null);
    private sealed record DataScope(string Mode, IReadOnlyList<string>? Columns = null);

    private static string SerializeValues(Dictionary<string, object?> values) =>
        JsonSerializer.Serialize(values.Select(kv => new { Column = IdentifierGuard.Column(kv.Key), Value = kv.Value }));

    private static IReadOnlyList<string> SelectColumns(IReadOnlyList<string> select, IReadOnlyList<ColumnMeta> columns)
    {
        var allowed = columns.Select(c => c.Column).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var selected = select.Count == 0 || select[0] == "*" ? [] : select.Where(s => s != "*" && allowed.Contains(s)).ToList();
        return (selected.Count == 0 ? columns.Select(c => c.Column) : selected).Select(IdentifierGuard.Column).ToArray();
    }

    // Pass structured, typed filters only. SQL construction belongs to the database.
    private async Task<List<DataFilter>> BuildFiltersAsync(string table, DataQueryRequest request, CancellationToken ct)
    {
        var fks = request.Filters.Any(f => f.Column.Contains('.')) || request.OrFilters.Any(g => g.Filters.Any(f => f.Column.Contains('.')))
            ? await catalog.GetForeignKeysAsync(ct) : Array.Empty<ForeignKeyMeta>();
        var result = request.Filters.Select(f => PrepareFilter(table, f, 0, fks)).ToList();
        for (var i = 0; i < request.OrFilters.Count; i++)
            result.AddRange(request.OrFilters[i].Filters.Select(f => PrepareFilter(table, f, i + 1, fks)));
        return result;
    }

    private static DataFilter PrepareFilter(string table, FilterOp f, int group, IReadOnlyList<ForeignKeyMeta> fks)
    {
        string? relation = null, foreignColumn = null, localColumn = null;
        var column = f.Column;
        if (column.Contains('.') && IdentifierGuard.IsPath(column))
        {
            var bits = column.Split('.');
            relation = IdentifierGuard.Table(bits[0]);
            column = bits[1];
            var fk = fks.FirstOrDefault(x => x.Table.Equals(relation, StringComparison.OrdinalIgnoreCase) && x.RefTable.Equals(table, StringComparison.OrdinalIgnoreCase))
                ?? fks.FirstOrDefault(x => x.RefTable.Equals(relation, StringComparison.OrdinalIgnoreCase) && x.Table.Equals(table, StringComparison.OrdinalIgnoreCase));
            var many = fk?.Table.Equals(relation, StringComparison.OrdinalIgnoreCase) == true;
            foreignColumn = IdentifierGuard.Column(fk is null ? table + "_id" : many ? fk.Column : fk.RefColumn);
            localColumn = IdentifierGuard.Column(fk is null ? "id" : many ? fk.RefColumn : fk.Column);
        }
        IdentifierGuard.Column(column);
        var op = f.Operator.ToLowerInvariant();
        var negated = op.StartsWith("not.", StringComparison.Ordinal);
        if (negated) op = op[4..];
        object? value;
        if (op == "in")
            value = f.Value.Trim('(', ')').Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(v => Coerce(v.Trim('"'))).ToArray();
        else if (op is "like" or "ilike") value = f.Value.Replace("*", "%");
        else if (op is "cs" or "cd") value = "%" + f.Value.Trim('%') + "%";
        else if (op == "is" && f.Value.Equals("null", StringComparison.OrdinalIgnoreCase)) { op = "isnull"; value = null; }
        else { value = Coerce(f.Value); if (op == "is") op = "eq"; }
        return new DataFilter(column, op, value, negated, group, relation, foreignColumn, localColumn);
    }

    private async Task<DataScope> RowSecurityAsync(string schema, string table, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (user.IsServiceRole) return new("none");
        var t = table.ToLowerInvariant();

        // Public reference catalogues (campus directory, org structure) must not
        // require a user id — students and staff both read them the same way.
        if (t is "universities" or "campuses" or "colleges" or "departments" or "academic_programs" or "academic_terms"
            or "courses" or "course_sections" or "course_prerequisites" or "service_units" or "university_services"
            or "case_categories" or "appointment_types" or "appointment_slots" or "emergency_contacts"
            or "faq_items" or "knowledge_document_categories" or "bilingual_terms" or "hostels" or "hostel_rooms"
            or "housing_eligibility_rules" or "internship_organizations" or "internship_opportunities"
            or "career_roles" or "career_matching_weight_profiles" or "document_templates" or "document_retention_policies"
            or "notification_event_types" or "notification_templates" or "program_courses" or "program_requirement_baskets"
            or "program_basket_courses" or "programme_course_equivalencies" or "service_requirements"
            or "service_workflow_steps" or "service_availability_windows" or "service_degradation_state"
            or "staff_profiles" or "library_locations" or "library_opening_hours"
            or "library_hours_exceptions" or "library_services")
            return new("none");

        var uid = user.UserId ?? throw new UnauthorizedException();

        if (t == "profiles")
            return user.IsStaff ? new("none") : new("owner", ["id"]);
        if (t == "user_roles")
            return user.HasRole(AppRoles.SystemAdmin) ? new("none") : new("owner", ["user_id"]);
        if (t == "notification_deliveries")
            return user.IsStaff ? new("none") : new("owner", ["recipient_user_id"]);
        if (t is "conversations" or "messages" or "agent_runs" or "tool_calls" or "detected_intents"
            or "citations" or "feedback" or "consent_records" or "notification_preferences"
            or "operation_idempotency")
            return user.IsStaff ? new("none") : await OwnerColumnScopeAsync(schema, table, cancellationToken, "user_id", "student_id");
        if (t == "cases")
        {
            if (await permissions.CanSeeAllCasesAsync(uid, cancellationToken)) return new("none");
            if (user.IsStaff)
                return new("staffCases");
            return new("owner", ["student_id"]);
        }
        if (t.StartsWith("case_", StringComparison.Ordinal) || t is "action_requests" or "action_receipts" or "approval_requests")
        {
            if (await permissions.CanSeeAllCasesAsync(uid, cancellationToken)) return new("none");
            return new("caseRelated");
        }
        if (t.Contains("student") || t is "suggestions" or "student_alerts" or "issued_documents"
            or "student_appointments" or "housing_applications" or "housing_allocations" or "internship_assignments")
            return user.IsStaff ? new("none") : await OwnerColumnScopeAsync(schema, table, cancellationToken, "student_id", "user_id");

        return new("none");
    }

    /// <summary>
    /// Builds an owner filter from columns that actually exist on the table.
    /// student_profiles is keyed by user_id and has no student_id; referencing a
    /// missing column made every signed-in student read 500 and look like they
    /// had no academic record.
    /// </summary>
    private async Task<DataScope> OwnerColumnScopeAsync(
        string schema, string table, CancellationToken cancellationToken, params string[] candidates)
    {
        var columns = await catalog.GetColumnsAsync(schema, table, cancellationToken);
        var names = columns.Select(c => c.Column).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var parts = candidates
            .Where(names.Contains)
            .Select(IdentifierGuard.Column)
            .ToList();
        if (parts.Count == 0) return new("deny");
        return new("owner", parts);
    }

    private async Task AttachEmbedsAsync(
        string schema, string table, IReadOnlyList<EmbedSpec> embeds,
        List<IDictionary<string, object?>> rows, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (embeds.Count == 0 || rows.Count == 0) return;
        var fks = await catalog.GetForeignKeysAsync(cancellationToken);
        foreach (var embed in embeds)
        {
            var fk = fks.FirstOrDefault(x =>
                x.Table.Equals(table, StringComparison.OrdinalIgnoreCase)
                && (embed.ForeignKeyHint is null
                    ? x.RefTable.Equals(embed.Alias, StringComparison.OrdinalIgnoreCase)
                    : x.Column.Equals(embed.ForeignKeyHint, StringComparison.OrdinalIgnoreCase)))
                ?? fks.FirstOrDefault(x =>
                    x.RefTable.Equals(table, StringComparison.OrdinalIgnoreCase)
                    && x.Table.Equals(embed.Alias, StringComparison.OrdinalIgnoreCase));

            if (fk is null) continue;
            var many = fk.RefTable.Equals(table, StringComparison.OrdinalIgnoreCase);
            var localCol = many ? fk.RefColumn : fk.Column;
            var remoteSchema = many ? fk.Schema : fk.RefSchema;
            var remoteTable = many ? fk.Table : fk.RefTable;
            var remoteCol = many ? fk.Column : fk.RefColumn;
            var ids = rows.Select(r => r.TryGetValue(localCol, out var v) ? v : null)
                .Where(v => v is not null && v is not DBNull)
                .Distinct()
                .ToArray();
            if (ids.Length == 0)
            {
                foreach (var r in rows) r[embed.Alias] = many ? Array.Empty<object>() : null;
                continue;
            }
            var remoteCols = await catalog.GetColumnsAsync(remoteSchema, remoteTable, cancellationToken);
            var nestedHints = EnumerateEmbedHints(embed.Embeds).ToList();
            var remoteSelect = embed.Columns.ToList();
            // Nested-only selects leave Columns empty — still need the join/PK columns.
            if (remoteSelect.Count == 0)
                remoteSelect.Add("*");
            if (!remoteSelect.Contains("*", StringComparer.OrdinalIgnoreCase))
            {
                if (!remoteSelect.Contains(remoteCol, StringComparer.OrdinalIgnoreCase))
                    remoteSelect.Add(remoteCol);
                foreach (var hint in nestedHints)
                {
                    if (!remoteSelect.Contains(hint, StringComparer.OrdinalIgnoreCase))
                        remoteSelect.Add(hint);
                }
            }
            var selected = SelectColumns(remoteSelect, remoteCols);
            // Match the existing embed lookup: only parent keys are used here.
            var filters = new[] { new DataFilter(IdentifierGuard.Column(remoteCol), "in", ids.Select(v => Convert.ToString(v, CultureInfo.InvariantCulture)).ToArray()) };
            await using var conn = connections.Create();
            var related = (await conn.QueryAsync(DbProc.Call("usp_Data_Select", new
            {
                schemaName = remoteSchema, tableName = remoteTable,
                columns = JsonSerializer.Serialize(selected), filters = JsonSerializer.Serialize(filters)
            }, cancellationToken))).Select(ToDict).ToList();

            if (embed.Embeds.Count > 0 && related.Count > 0)
                await AttachEmbedsAsync(remoteSchema, remoteTable, embed.Embeds, related, user, cancellationToken);

            foreach (var parent in rows)
            {
                parent.TryGetValue(localCol, out var key);
                var matches = related.Where(c => EqualsKey(c.TryGetValue(remoteCol, out var rv) ? rv : null, key)).ToList();
                parent[embed.Alias] = many ? matches : matches.FirstOrDefault();
            }
        }
    }

    private static IEnumerable<string> EnumerateEmbedHints(IEnumerable<EmbedSpec> embeds)
    {
        foreach (var embed in embeds)
        {
            if (!string.IsNullOrWhiteSpace(embed.ForeignKeyHint))
                yield return embed.ForeignKeyHint!;
            foreach (var nested in EnumerateEmbedHints(embed.Embeds))
                yield return nested;
        }
    }

    private static bool EqualsKey(object? a, object? b)
    {
        if (a is null || b is null || a is DBNull || b is DBNull) return false;
        if (a is Guid ga)
        {
            if (b is Guid gb) return ga == gb;
            return Guid.TryParse(Convert.ToString(b, CultureInfo.InvariantCulture), out var pb) && ga == pb;
        }
        if (b is Guid gbb)
            return Guid.TryParse(Convert.ToString(a, CultureInfo.InvariantCulture), out var pa) && pa == gbb;
        return string.Equals(
            Convert.ToString(a, CultureInfo.InvariantCulture),
            Convert.ToString(b, CultureInfo.InvariantCulture),
            StringComparison.OrdinalIgnoreCase);
    }

    private static IDictionary<string, object?> ToDict(dynamic row)
    {
        if (row is IDictionary<string, object> d)
            return d.ToDictionary(kv => kv.Key, kv => NormalizeValue(kv.Value), StringComparer.OrdinalIgnoreCase);
        var dict = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in (IDictionary<string, object>)row)
            dict[p.Key] = NormalizeValue(p.Value);
        return dict;
    }

    private static object? NormalizeValue(object? value) =>
        value is DBNull ? null
        : value is DateTimeOffset dto ? dto.ToString("o")
        : value is DateTime dt ? DateTime.SpecifyKind(dt, DateTimeKind.Utc).ToString("o")
        : value is DateOnly dateOnly ? dateOnly.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        : value is TimeOnly timeOnly ? timeOnly.ToString("HH:mm:ss", CultureInfo.InvariantCulture)
        : value is TimeSpan ts ? ts.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture)
        : value;

    private static object? ToDb(object? value) => value is JsonElement je ? FromJson(je) : value;

    private static object? FromJson(JsonElement je) => je.ValueKind switch
    {
        JsonValueKind.Null => null,
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number => je.TryGetInt64(out var l) ? l : je.GetDecimal(),
        JsonValueKind.String => je.GetString(),
        _ => je.GetRawText()
    };

    private static object? Coerce(string value)
    {
        if (value.Equals("true", StringComparison.OrdinalIgnoreCase)) return true;
        if (value.Equals("false", StringComparison.OrdinalIgnoreCase)) return false;
        if (Guid.TryParse(value, out var g)) return g;
        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)) return n;
        if (decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var d)) return d;
        // Prefer date-only for SQL `date` columns (e.g. exception_date=gte.2026-09-15).
        if (DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateOnly))
            return dateOnly.ToDateTime(TimeOnly.MinValue);
        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
            return dto;
        return value;
    }

    private static List<Dictionary<string, object?>> NormalizePayload(object? payload)
    {
        if (payload is null) return [];
        var json = payload is JsonElement el ? el : JsonSerializer.SerializeToElement(payload, JsonOpts);
        if (json.ValueKind == JsonValueKind.Array)
            return json.EnumerateArray().Select(ParseObject).ToList();
        if (json.ValueKind == JsonValueKind.Object)
            return [ParseObject(json)];
        return [];
    }

    private static Dictionary<string, object?> ParseObject(JsonElement el)
    {
        var d = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in el.EnumerateObject())
            d[p.Name] = FromJson(p.Value);
        return d;
    }
}

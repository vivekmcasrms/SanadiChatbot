using System.Data.Common;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed class KnowledgeConnectorsService
{
    public async Task<ConnectorToolResult> RunToolAsync(
        DbConnection db,
        Guid userId,
        IReadOnlyList<string> roles,
        string toolName,
        Dictionary<string, object?>? parameters = null,
        bool preview = false)
    {
        var started = Environment.TickCount64;
        ConnectorToolResult Fail(string status, string error, string source = "Unknown", Guid? connectorId = null, Guid? toolId = null) => new(
            Status: status,
            Source: source,
            RetrievedAt: DateTime.UtcNow.ToString("O"),
            DataFreshness: "unavailable",
            Data: null,
            Error: error,
            LatencyMs: Environment.TickCount64 - started,
            ToolId: toolId,
            ConnectorId: connectorId);

        var tool = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_GetTool", new { toolName }));
        if (tool is null) return Fail("error", $"Unknown connector tool: {toolName}");
        if (tool.enabled is bool en && !en) return Fail("denied", "This connector tool is disabled.", "Disabled tool", (Guid)tool.connector_id, (Guid)tool.id);

        var connector = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_GetConnector", new { id = (Guid)tool.connector_id }));
        if (connector is null) return Fail("error", "Connector not found.", "Unknown", (Guid)tool.connector_id, (Guid)tool.id);
        if (connector.is_active is bool ca && !ca) return Fail("denied", "The connector is disabled.", (string)connector.source_system, (Guid)connector.id, (Guid)tool.id);
        if ((string?)connector.health_status == "offline") return Fail("error", "The source system is currently offline.", (string)connector.source_system, (Guid)connector.id, (Guid)tool.id);
        if ((string?)tool.operation_type != "read" && connector.write_enabled is bool we && !we)
            return Fail("denied", "Write access is disabled for this connector.", (string)connector.source_system, (Guid)connector.id, (Guid)tool.id);

        var allowedRoles = AsStringArray(tool.allowed_roles);
        var callerRoles = roles.Count > 0 ? roles : ["student"];
        if (allowedRoles.Length > 0 && !callerRoles.Any(r => allowedRoles.Contains(r, StringComparer.OrdinalIgnoreCase))
            && !callerRoles.Contains("system_admin", StringComparer.OrdinalIgnoreCase))
            return Fail("denied", "You are not authorised to use this connector tool.", (string)connector.source_system, (Guid)connector.id, (Guid)tool.id);

        var parametersSafe = new Dictionary<string, object?>(parameters ?? new(), StringComparer.OrdinalIgnoreCase);
        foreach (var key in new[] { "student_id", "user_id", "student_number", "national_id" })
            parametersSafe.Remove(key);

        Dictionary<string, object?>? raw;
        try { raw = await InvokeHandlerAsync(db, toolName, parametersSafe, userId); }
        catch (Exception ex) { return Fail("error", ex.Message, (string)connector.source_system, (Guid)connector.id, (Guid)tool.id); }
        if (raw is null) return Fail("error", "No record was returned for the signed-in user.", (string)connector.source_system, (Guid)connector.id, (Guid)tool.id);

        var mapped = await ApplyFieldMappingsAsync(db, (Guid)connector.id, raw);
        var projected = Project(mapped.Data, AsStringArray(tool.allowed_fields), AsStringArray(tool.blocked_fields));
        var freshness = (string?)connector.health_status == "degraded" ? "cached" : "live";

        return new ConnectorToolResult(
            Status: "success",
            Source: (string)connector.source_system,
            RetrievedAt: DateTime.UtcNow.ToString("O"),
            DataFreshness: preview ? "live" : freshness,
            Data: projected,
            MaskedFields: mapped.Masked,
            LatencyMs: Environment.TickCount64 - started,
            ToolId: (Guid)tool.id,
            ConnectorId: (Guid)connector.id);
    }

    public static object DescribeShape(object? value)
    {
        if (value is null) return "null";
        if (value is string) return "string";
        if (value is JsonElement je) return DescribeShape(JsonElementToObject(je));
        if (value is IDictionary<string, object?> dict)
            return dict.ToDictionary(kv => kv.Key, kv => DescribeShape(kv.Value));
        if (value is IReadOnlyDictionary<string, object?> rod)
            return rod.ToDictionary(kv => kv.Key, kv => DescribeShape(kv.Value));
        if (value is System.Collections.IEnumerable list)
        {
            object? first = null;
            foreach (var item in list) { first = item; break; }
            return new object[] { first is null ? "unknown" : DescribeShape(first) };
        }
        return value.GetType().Name.ToLowerInvariant() switch
        {
            "int32" or "int64" or "decimal" or "double" or "single" => "number",
            "boolean" or "bool" => "boolean",
            _ => "object"
        };
    }

    public static string SchemaHash(object snapshot)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(snapshot));
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static async Task<(Dictionary<string, object?> Data, List<string> Masked)> ApplyFieldMappingsAsync(
        DbConnection db, Guid connectorId, Dictionary<string, object?> raw)
    {
        var mappings = (await db.QueryAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListFieldMappings", new { connectorId }))).ToList();
        if (mappings.Count == 0) return (raw, []);

        var outData = new Dictionary<string, object?>(raw, StringComparer.OrdinalIgnoreCase);
        var masked = new List<string>();
        foreach (var m in mappings)
        {
            var external = (string)m.external_field;
            if (!raw.ContainsKey(external)) continue;
            object? value = raw[external];
            if (value is null) value = m.default_value;
            switch ((string?)m.transformation_rule)
            {
                case "boolean_normalise":
                    value = value is true or "Y" or "yes" or 1 or "1";
                    break;
                case "date_iso":
                    value = value is null ? null : DateTime.TryParse(value.ToString(), out var d) ? d.ToString("yyyy-MM-dd") : null;
                    break;
                case "number":
                    value = value is null ? null : Convert.ToDouble(value);
                    break;
                case "upper":
                    value = value?.ToString()?.ToUpperInvariant();
                    break;
            }
            var internalField = (string)m.internal_field;
            if (m.sensitive is bool s && s)
            {
                masked.Add(internalField);
                var str = value?.ToString() ?? "";
                value = (string?)m.masking_rule == "last4" ? $"••••{str[^Math.Min(4, str.Length)..]}" : "••••••";
            }
            outData.Remove(external);
            outData[internalField] = value;
        }
        return (outData, masked);
    }

    private static Dictionary<string, object?> Project(Dictionary<string, object?> data, string[] allowed, string[] blocked)
    {
        var outData = new Dictionary<string, object?>(data, StringComparer.OrdinalIgnoreCase);
        if (allowed.Length > 0)
            outData = outData.Where(kv => allowed.Contains(kv.Key, StringComparer.OrdinalIgnoreCase))
                .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.OrdinalIgnoreCase);
        foreach (var b in blocked) outData.Remove(b);
        return outData;
    }

    private static async Task<Dictionary<string, object?>?> InvokeHandlerAsync(
        DbConnection db, string toolName, Dictionary<string, object?> parameters, Guid userId)
    {
        switch (toolName)
        {
            case "get_student_academic_summary":
            {
                var row = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_GetAcademicSummary", new { userId }));
                return row is null ? null : ToDict(row);
            }
            case "get_student_holds":
            {
                var rows = (await db.QueryAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListActiveHolds", new { userId }))).Select(ToDict).ToList();
                return new Dictionary<string, object?> { ["holds"] = rows, ["active_count"] = rows.Count };
            }
            case "get_student_registration_status":
            {
                var profile = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_GetRegistrationProfile", new { userId }));
                var holds = (await db.QueryAsync<string>(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListRegistrationBlockingHolds", new { userId }))).ToList();
                return new Dictionary<string, object?>
                {
                    ["registered_credit_hours"] = profile?.registered_credit_hours ?? 0,
                    ["academic_standing"] = profile?.academic_standing,
                    ["registration_blocked"] = holds.Count > 0,
                    ["blocking_holds"] = holds
                };
            }
            case "get_course_availability":
            {
                var code = (parameters.TryGetValue("course_code", out var c) ? c?.ToString() : "")?.ToUpperInvariant() ?? "";
                var rows = (await db.QueryAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListCourseSections", null)))
                    .Where(r => string.IsNullOrEmpty(code) || ((string?)r.course_code ?? "").ToUpperInvariant().Contains(code))
                    .Select(r =>
                    {
                        var d = ToDict(r);
                        d["seats_available"] = ((int?)r.capacity ?? 0) - ((int?)r.enrolled_count ?? 0);
                        return d;
                    }).ToList();
                return new Dictionary<string, object?> { ["sections"] = rows };
            }
            case "get_internship_status":
            {
                var profile = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_GetInternshipProfile", new { userId }));
                var credits = (int?)(profile?.completed_credit_hours) ?? 0;
                return new Dictionary<string, object?>
                {
                    ["completed_credit_hours"] = credits, ["credit_requirement"] = 80,
                    ["meets_credit_requirement"] = credits >= 80, ["gpa"] = profile?.cumulative_gpa, ["academic_standing"] = profile?.academic_standing
                };
            }
            case "get_graduation_status":
            {
                var profile = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_GetGraduationProfile", new { userId }));
                var blocked = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_ConnectorsSvc_CountGraduationBlockingHolds", new { userId }));
                return new Dictionary<string, object?>
                {
                    ["completed_credit_hours"] = profile?.completed_credit_hours ?? 0, ["required_credit_hours"] = 120,
                    ["cumulative_gpa"] = profile?.cumulative_gpa, ["expected_graduation_date"] = profile?.expected_graduation_date,
                    ["graduation_blocked"] = blocked > 0
                };
            }
            case "get_case_status":
            {
                var number = parameters.TryGetValue("case_number", out var n) ? n?.ToString() ?? "" : "";
                var rows = await db.QueryAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListCases", new { userId, number }));
                return new Dictionary<string, object?> { ["cases"] = rows.Select(ToDict).ToList() };
            }
            case "get_available_appointments":
            {
                var rows = await db.QueryAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListOpenSlots", null));
                return new Dictionary<string, object?> { ["slots"] = rows.Select(ToDict).ToList() };
            }
            case "get_student_account_balance":
            {
                var active = await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Knowledge_ConnectorsSvc_CountFinancialHolds", new { userId }));
                return new Dictionary<string, object?> { ["outstanding_balance_aed"] = active > 0 ? 2450 : 0, ["currency"] = "AED" };
            }
            case "get_it_service_status":
                return new Dictionary<string, object?>
                {
                    ["services"] = new object[]
                    {
                        new Dictionary<string, object?> { ["name"] = "Wi-Fi", ["status"] = "operational" },
                        new Dictionary<string, object?> { ["name"] = "Portal", ["status"] = "operational" }
                    }
                };
            case "get_transport_schedule":
                return new Dictionary<string, object?>
                {
                    ["routes"] = new object[]
                    {
                        new Dictionary<string, object?>
                        {
                            ["route"] = "Al Ain City ↔ Campus", ["first_departure"] = "06:45",
                            ["last_departure"] = "20:15", ["frequency_minutes"] = 30
                        }
                    }
                };
            case "get_advising_appointments":
            {
                var rows = await db.QueryAsync(DbProc.Call("usp_Knowledge_ConnectorsSvc_ListAppointments", new { userId }));
                return new Dictionary<string, object?> { ["appointments"] = rows.Select(ToDict).ToList() };
            }
            default:
                throw new SanadiException("No handler is registered for this tool.");
        }
    }

    private static Dictionary<string, object?> ToDict(object row)
    {
        if (row is IDictionary<string, object> d)
            return d.ToDictionary(kv => kv.Key, kv => (object?)kv.Value, StringComparer.OrdinalIgnoreCase);
        var result = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in row.GetType().GetProperties())
            result[p.Name] = p.GetValue(row);
        return result;
    }

    private static string[] AsStringArray(object? value)
    {
        if (value is null) return [];
        if (value is string s)
        {
            try
            {
                using var doc = JsonDocument.Parse(s);
                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    return doc.RootElement.EnumerateArray().Select(e => e.GetString() ?? "").Where(x => x.Length > 0).ToArray();
            }
            catch { return []; }
        }
        if (value is IEnumerable<object> list) return list.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToArray();
        return [];
    }

    private static object? JsonElementToObject(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.Object => e.EnumerateObject().ToDictionary(p => p.Name, p => JsonElementToObject(p.Value)),
        JsonValueKind.Array => e.EnumerateArray().Select(JsonElementToObject).ToList(),
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => null
    };
}

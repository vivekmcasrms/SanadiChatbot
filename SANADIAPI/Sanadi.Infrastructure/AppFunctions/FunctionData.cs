using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Sanadi.Application.Data;
using Sanadi.Application.Rpc;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;

namespace Sanadi.Infrastructure.AppFunctions;

/// <summary>Shares SANADIAPI's scoped SQL access with migrated business workflows.</summary>
public sealed class FunctionData(IDataQueryService data, IRpcExecutor rpc)
{
    // Only workflow code can select this principal, after its explicit authorization check.
    internal static readonly ICurrentUser Trusted = new WorkflowPrincipal();
    public static FilterOp Eq(string column, object? value) => Filter(column, "eq", value);
    public static FilterOp Filter(string column, string op, object? value) => new()
    { Column = column, Operator = op, Value = Convert.ToString(value, CultureInfo.InvariantCulture) ?? "null" };
    public static FilterOp In(string column, IEnumerable<string> values) => Filter(column, "in", $"({string.Join(',', values)})");
    public static OrderSpec Order(string column, bool descending = false) => new() { Column = column, Descending = descending };

    public async Task<JsonObject[]> Rows(string table, string columns, ICurrentUser user, CancellationToken ct,
        IReadOnlyList<FilterOp>? filters = null, IReadOnlyList<OrderSpec>? order = null, int? limit = null,
        bool tolerateError = true, IReadOnlyList<EmbedSpec>? embeds = null)
    {
        try
        {
            var result = await data.ExecuteAsync(new DataQueryRequest
            {
                Table = table, Select = columns.Split(',').Select(s => s.Trim()).ToArray(), Filters = filters ?? [],
                Order = order ?? [], Limit = limit, Embeds = embeds ?? []
            }, user, ct);
            return AsRows(result.Data);
        }
        catch (Exception ex) when (tolerateError && IsQueryError(ex)) { return []; }
    }

    public static JsonObject[] AsRows(object? value) => JsonSerializer.SerializeToNode(value) is JsonArray rows
        ? rows.OfType<JsonObject>().ToArray() : [];

    public async Task<JsonObject?> One(string table, string columns, ICurrentUser user, CancellationToken ct,
        IReadOnlyList<FilterOp>? filters = null, IReadOnlyList<OrderSpec>? order = null, int? limit = null, bool tolerateError = true)
    {
        var rows = await Rows(table, columns, user, ct, filters, order, limit, tolerateError);
        if (rows.Length == 1) return rows[0];
        if (rows.Length > 1 && !tolerateError) throw new SanadiException("Multiple rows returned for a single-object query.", 406);
        return null;
    }

    public async Task<object?> Write(string table, string method, object? payload, ICurrentUser user, CancellationToken ct,
        IReadOnlyList<FilterOp>? filters = null, bool tolerateError = false, bool returning = false,
        string[]? conflict = null, bool ignoreDuplicates = false, IReadOnlyList<OrGroup>? orFilters = null)
    {
        try
        {
            var result = await data.ExecuteAsync(new DataQueryRequest
            {
                Table = table, Method = method, Payload = payload, Filters = filters ?? [],
                PreferRepresentation = returning, Upsert = conflict is not null, OnConflict = conflict,
                IgnoreDuplicates = ignoreDuplicates, OrFilters = orFilters ?? []
            }, user, ct);
            return result.Data;
        }
        catch (Exception ex) when (tolerateError && IsQueryError(ex)) { return null; }
    }

    public async Task<object?> Rpc(string name, object args, ICurrentUser user, CancellationToken ct, bool tolerateError = false)
    {
        try { return await rpc.ExecuteAsync(name, JsonSerializer.SerializeToElement(args), user, ct); }
        catch (Exception ex) when (tolerateError && IsQueryError(ex)) { return null; }
    }

    public async Task<string[]> Roles(ICurrentUser user, CancellationToken ct)
    {
        RequireUser(user);
        return (await Rows("user_roles", "role", user, ct, [Eq("user_id", user.UserId)]))
            .Select(r => r.S("role") ?? "").ToArray();
    }

    public async Task RequireRoles(ICurrentUser user, CancellationToken ct, string message, params string[] allowed)
    {
        if (!(await Roles(user, ct)).Any(allowed.Contains)) throw new ForbiddenException(message);
    }

    public static Guid RequireUser(ICurrentUser user) => user.IsAuthenticated && user.UserId is { } id ? id : throw new UnauthorizedException();
    private static bool IsQueryError(Exception ex) => ex is SanadiException or SqlException;
    private sealed class WorkflowPrincipal : ICurrentUser
    {
        public Guid? UserId => null;
        public string? Email => null;
        public IReadOnlyList<string> Roles => AppRoles.Staff;
        public bool IsAuthenticated => true;
        public bool IsServiceRole => true;
    }
}

public static class FunctionJson
{
    public static string? S(this JsonNode? row, string name) => row?[name]?.ToString();
    public static double N(this JsonNode? row, string name, double fallback = 0) =>
        double.TryParse(row.S(name), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : fallback;
    public static bool B(this JsonNode? row, string name) => row?[name] is { } n && n.ToJsonString() is not ("false" or "null" or "0" or "\"\"");
    public static double Round(double value, int digits = 0) { var scale = Math.Pow(10, digits); return Math.Floor(value * scale + 0.5) / scale; }
    public static double Percentile(IEnumerable<double> values, double p)
    {
        var sorted = values.Order().ToArray();
        return sorted.Length == 0 ? 0 : sorted[Math.Min(sorted.Length - 1, (int)Math.Floor(p / 100 * sorted.Length))];
    }
}

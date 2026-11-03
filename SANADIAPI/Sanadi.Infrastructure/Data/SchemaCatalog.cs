using Dapper;
using Microsoft.Extensions.Caching.Memory;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Data;

public sealed record ColumnMeta(string Schema, string Table, string Column, string DataType);
public sealed record ForeignKeyMeta(
    string Schema, string Table, string Column,
    string RefSchema, string RefTable, string RefColumn);

public sealed class SchemaCatalog
{
    private readonly ISqlConnectionFactory _factory;
    private readonly IMemoryCache _cache;

    public SchemaCatalog(ISqlConnectionFactory factory, IMemoryCache cache)
    {
        _factory = factory;
        _cache = cache;
    }

    public async Task<IReadOnlySet<string>> GetTablesAsync(CancellationToken cancellationToken)
    {
        var rows = await LoadColumnsAsync(cancellationToken);
        return rows.Select(c => $"{c.Schema}.{c.Table}").ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    public async Task<IReadOnlyList<ColumnMeta>> GetColumnsAsync(string schema, string table, CancellationToken cancellationToken)
    {
        var rows = await LoadColumnsAsync(cancellationToken);
        return rows.Where(c => c.Schema.Equals(schema, StringComparison.OrdinalIgnoreCase)
                            && c.Table.Equals(table, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    public async Task<(string Schema, string Table)> ResolveTableAsync(string name, CancellationToken cancellationToken)
    {
        IdentifierGuard.Table(name);
        // Server-only email authorization/configuration is never a browser data resource.
        if (name.Equals("sso_email_tokens", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("ticket_email_activation", StringComparison.OrdinalIgnoreCase))
            throw new Domain.Exceptions.NotFoundException();
        var tables = await GetTablesAsync(cancellationToken);
        if (tables.Contains($"dbo.{name}")) return ("dbo", name);
        if (tables.Contains($"auth.{name}")) return ("auth", name);
        if (tables.Contains($"storage.{name}")) return ("storage", name);
        throw new Domain.Exceptions.NotFoundException($"Unknown table '{name}'.");
    }

    public async Task<IReadOnlyList<string>> GetPrimaryKeyAsync(string schema, string table, CancellationToken cancellationToken)
    {
        var rows = await _cache.GetOrCreateAsync("sanadi:pks", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            await using var conn = _factory.Create();
            await conn.OpenAsync(cancellationToken);
            var list = await conn.QueryAsync<(string Schema, string Table, string Column, int Ordinal)>(
                DbProc.Call("usp_CatalogPrimaryKeys", null, cancellationToken));
            return list.ToList();
        }) ?? [];
        return rows
            .Where(r => r.Schema.Equals(schema, StringComparison.OrdinalIgnoreCase)
                     && r.Table.Equals(table, StringComparison.OrdinalIgnoreCase))
            .OrderBy(r => r.Ordinal)
            .Select(r => r.Column)
            .ToList();
    }

    public async Task<IReadOnlyList<ForeignKeyMeta>> GetForeignKeysAsync(CancellationToken cancellationToken)
    {
        return await _cache.GetOrCreateAsync("sanadi:fks", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            await using var conn = _factory.Create();
            await conn.OpenAsync(cancellationToken);
            var rows = await conn.QueryAsync<ForeignKeyMeta>(
                DbProc.Call("usp_CatalogForeignKeys", null, cancellationToken));
            return rows.ToList();
        }) ?? [];
    }

    private Task<List<ColumnMeta>> LoadColumnsAsync(CancellationToken cancellationToken) =>
        _cache.GetOrCreateAsync("sanadi:columns", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            await using var conn = _factory.Create();
            await conn.OpenAsync(cancellationToken);
            var rows = await conn.QueryAsync<ColumnMeta>(
                DbProc.Call("usp_CatalogColumns", null, cancellationToken));
            return rows.Where(c => !c.Table.Equals("sso_email_tokens", StringComparison.OrdinalIgnoreCase) &&
                !c.Table.Equals("ticket_email_activation", StringComparison.OrdinalIgnoreCase)).ToList();
        })!;
}

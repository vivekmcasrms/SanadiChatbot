using Sanadi.Domain.Security;

namespace Sanadi.Application.Data;

public sealed class FilterOp
{
    public required string Column { get; init; }
    public required string Operator { get; init; }
    public required string Value { get; init; }
}

public sealed class OrGroup
{
    public required IReadOnlyList<FilterOp> Filters { get; init; }
}

public sealed class OrderSpec
{
    public required string Column { get; init; }
    public bool Descending { get; init; }
    public bool NullsFirst { get; init; }
}

public sealed class EmbedSpec
{
    public required string Alias { get; init; }
    public string? ForeignKeyHint { get; init; }
    public IReadOnlyList<string> Columns { get; init; } = ["*"];
    public IReadOnlyList<EmbedSpec> Embeds { get; init; } = [];
}

public sealed class DataQueryRequest
{
    public required string Table { get; init; }
    public string Schema { get; init; } = "dbo";
    public string Method { get; init; } = "GET";
    public IReadOnlyList<string> Select { get; init; } = ["*"];
    public IReadOnlyList<EmbedSpec> Embeds { get; init; } = [];
    public IReadOnlyList<FilterOp> Filters { get; init; } = [];
    public IReadOnlyList<OrGroup> OrFilters { get; init; } = [];
    public IReadOnlyList<OrderSpec> Order { get; init; } = [];
    public int? Limit { get; init; }
    public int? Offset { get; init; }
    public bool PreferRepresentation { get; init; }
    public bool CountExact { get; init; }
    public bool HeadOnly { get; init; }
    public bool SingleObject { get; init; }
    public object? Payload { get; init; }
    public bool Upsert { get; init; }
    public bool IgnoreDuplicates { get; init; }
    public IReadOnlyList<string>? OnConflict { get; init; }
}

public sealed class DataQueryResult
{
    public object? Data { get; init; }
    public int? Count { get; init; }
}

public interface IDataQueryService
{
    Task<DataQueryResult> ExecuteAsync(DataQueryRequest request, ICurrentUser user, CancellationToken cancellationToken);
}

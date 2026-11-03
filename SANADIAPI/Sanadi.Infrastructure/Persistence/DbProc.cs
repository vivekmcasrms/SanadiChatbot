using System.Data;
using Dapper;

namespace Sanadi.Infrastructure.Persistence;

public static class DbProc
{
    public static CommandDefinition Call(
        string name, object? param, CancellationToken cancellationToken = default, IDbTransaction? transaction = null) =>
        new(name, param, transaction, commandType: CommandType.StoredProcedure, cancellationToken: cancellationToken);

    /// <summary>Comma-separated values for STRING_SPLIT parameters in usp_ procedures.</summary>
    public static string Csv(IEnumerable<Guid>? ids) =>
        ids is null ? "" : string.Join(",", ids);

    public static string Csv(IEnumerable<string>? values) =>
        values is null ? "" : string.Join(",", values.Where(v => !string.IsNullOrWhiteSpace(v)));
}

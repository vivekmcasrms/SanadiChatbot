using Dapper;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed record EmbeddingSettings(string Provider, string Model, string? ApiUrl, string? ApiKey);

public interface IEmbeddingSettingsProvider
{
    Task<EmbeddingSettings?> LoadAsync(CancellationToken ct);
}

public sealed class SqlEmbeddingSettingsProvider(ISqlConnectionFactory connections) : IEmbeddingSettingsProvider
{
    public async Task<EmbeddingSettings?> LoadAsync(CancellationToken ct)
    {
        await using var db = connections.Create();
        return await db.QuerySingleOrDefaultAsync<EmbeddingSettings>(
            DbProc.Call("usp_Knowledge_GetEmbeddingSettings", null, ct));
    }
}

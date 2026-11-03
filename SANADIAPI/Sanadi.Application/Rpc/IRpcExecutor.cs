using System.Text.Json;
using Sanadi.Domain.Security;

namespace Sanadi.Application.Rpc;

public interface IRpcHandler
{
    string Name { get; }
    Task<object?> ExecuteAsync(JsonElement args, ICurrentUser user, CancellationToken cancellationToken);
}

public interface IRpcExecutor
{
    Task<object?> ExecuteAsync(string name, JsonElement args, ICurrentUser user, CancellationToken cancellationToken);
}

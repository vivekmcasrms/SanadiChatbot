using System.Text.Json;
using Sanadi.Application.Rpc;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;

namespace Sanadi.Infrastructure.Rpc;

public sealed class RpcExecutor(IEnumerable<IRpcHandler> handlers) : IRpcExecutor
{
    private readonly Dictionary<string, IRpcHandler> _handlers =
        handlers.ToDictionary(h => h.Name, h => h, StringComparer.OrdinalIgnoreCase);

    public Task<object?> ExecuteAsync(string name, JsonElement args, ICurrentUser user, CancellationToken cancellationToken)
    {
        if (!_handlers.TryGetValue(name, out var handler))
            throw new NotFoundException($"Unknown RPC '{name}'.");
        return handler.ExecuteAsync(args, user, cancellationToken);
    }
}

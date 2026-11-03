using Sanadi.Application.Realtime;

namespace Sanadi.Infrastructure.Realtime;

public sealed class NullRealtimePublisher : IRealtimePublisher
{
    public Task PublishTableChangeAsync(string table, string eventType, object payload, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}

namespace Sanadi.Application.Realtime;

public interface IRealtimePublisher
{
    Task PublishTableChangeAsync(string table, string eventType, object payload, CancellationToken cancellationToken);
}

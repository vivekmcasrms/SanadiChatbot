using System.Security.Claims;
using System.Security.Cryptography;

namespace Sanadi.Api.AI;

/// <summary>Single-use, short-lived WebSocket tickets; bearer tokens never appear in a URL.</summary>
public sealed class VoiceRoomTickets
{
    private readonly object gate = new();
    private readonly Dictionary<string, Ticket> tickets = [];
    private readonly Dictionary<Guid, CancellationTokenSource> active = [];
    public sealed record Ticket(ClaimsPrincipal Principal, string Origin, DateTimeOffset Expires);

    public string Issue(ClaimsPrincipal principal, string origin)
    {
        lock (gate)
        {
            foreach (var key in tickets.Where(p => p.Value.Expires <= DateTimeOffset.UtcNow).Select(p => p.Key).ToArray())
                tickets.Remove(key);
            if (tickets.Count >= 1000) throw new InvalidOperationException("voice_capacity");
            var keyValue = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            tickets.Add(keyValue, new Ticket(new ClaimsPrincipal(principal), origin, DateTimeOffset.UtcNow.AddSeconds(30)));
            return keyValue;
        }
    }
    public Ticket? Take(string key, string origin)
    {
        lock (gate)
            return tickets.Remove(key, out var ticket) && ticket.Expires > DateTimeOffset.UtcNow && ticket.Origin == origin
                ? ticket : null;
    }
    public void Enter(Guid user, CancellationTokenSource stop)
    {
        lock (gate)
        {
            if (active.TryGetValue(user, out var previous)) previous.Cancel();
            active[user] = stop;
        }
    }
    public void Leave(Guid user, CancellationTokenSource stop)
    {
        lock (gate)
            if (active.TryGetValue(user, out var current) && ReferenceEquals(current, stop)) active.Remove(user);
    }
}

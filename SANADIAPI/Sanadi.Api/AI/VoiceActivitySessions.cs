using System.Security.Claims;

namespace Sanadi.Api.AI;

/// <summary>VAD captures have their own tickets and lifetime; they never cancel the assistant call.</summary>
public sealed class VoiceActivitySessions
{
    private readonly VoiceRoomTickets captures = new();

    public string Issue(ClaimsPrincipal principal, string origin) => captures.Issue(principal, origin);
    public VoiceRoomTickets.Ticket? Take(string key, string origin) => captures.Take(key, origin);
    public void Enter(Guid user, CancellationTokenSource stop) => captures.Enter(user, stop);
    public void Leave(Guid user, CancellationTokenSource stop) => captures.Leave(user, stop);
}

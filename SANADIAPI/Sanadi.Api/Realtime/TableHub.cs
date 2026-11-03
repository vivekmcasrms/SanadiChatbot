using Microsoft.AspNetCore.SignalR;

namespace Sanadi.Api.Realtime;

public sealed class TableHub : Hub
{
    public Task Subscribe(string table, string? filter) =>
        Groups.AddToGroupAsync(Context.ConnectionId, table);
}

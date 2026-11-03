using System.Data;
using System.Data.Common;
using Dapper;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Routing;

internal static class TicketAssignment
{
    internal const int SqlErrorNumber = 51027;
    internal const string ErrorCode = "ticket_assignee_unavailable";
    internal const string ErrorMessage = "A responsible service unit could not be found. Please try again or contact support.";

    internal sealed record Assignment(Guid UnitId, string En, string Ar, Guid? Owner, string Method)
    {
        internal string Status => Owner is null ? "routed" : "assigned";
    }

    internal static async Task<Assignment> ResolveAsync(DbConnection db, Guid? unit, Guid requester,
        bool sensitive = false, Guid? preferredOwner = null, CancellationToken ct = default, IDbTransaction? tx = null)
    {
        // Missing routing/roster coverage is handled by the database's support-desk
        // fallback, not by rejecting the student's submission here.
        if (unit == Guid.Empty) unit = null;
        return await db.QuerySingleOrDefaultAsync<Assignment>(DbProc.Call("usp_Tickets_GetAssignment",
            new { unit, requester, sensitive, preferredOwner }, ct, tx)) ?? throw Unavailable();
    }

    internal static SanadiException Unavailable() => new(ErrorMessage, 409, ErrorCode);
}

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Sanadi.Api.Middleware;
using Sanadi.Api.Routing;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class TicketAssignmentTests
{
    [Theory]
    [InlineData(true, "assigned")]
    [InlineData(false, "routed")]
    public void Unit_queue_is_a_successful_routed_state_not_a_failed_submission(bool hasStaff, string status)
    {
        var assignment = new TicketAssignment.Assignment(Guid.NewGuid(), "Unit", "Unit",
            hasStaff ? Guid.NewGuid() : null, hasStaff ? "workload" : "unit_queue");
        Assert.Equal(status, assignment.Status);
    }

    [Fact]
    public async Task Assignment_failure_keeps_the_existing_safe_error_response_contract()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        await new ExceptionHandlingMiddleware(_ => Task.FromException(TicketAssignment.Unavailable()),
            NullLogger<ExceptionHandlingMiddleware>.Instance).InvokeAsync(context);
        Assert.Equal(409, context.Response.StatusCode);
        context.Response.Body.Position = 0;
        var body = await new StreamReader(context.Response.Body).ReadToEndAsync();
        Assert.Contains("ticket_assignee_unavailable", body);
        Assert.Contains("responsible service unit", body);
    }
}

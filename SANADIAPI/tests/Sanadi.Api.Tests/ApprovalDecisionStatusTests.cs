using Sanadi.Api.Controllers;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Api.Tests;

public sealed class ApprovalDecisionStatusTests
{
    [Theory]
    [InlineData("approved", "approved")]
    [InlineData("completed", "approved")]
    [InlineData("failed", "approved")]
    [InlineData("declined", "rejected")]
    public void Api_state_maps_to_an_allowed_approval_decision(string requested, string stored)
        => Assert.Equal(stored, ApprovalsController.StoredStatus(requested));

    [Fact]
    public void Unsupported_state_is_rejected()
        => Assert.Throws<SanadiException>(() => ApprovalsController.StoredStatus("pending"));
}

using System.Text.Json;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class DirectToolAuthorizationTests
{
    [Fact]
    public void Only_a_high_confidence_positive_check_authorizes_the_selected_action()
    {
        var raw = JsonSerializer.Serialize(new { authorized = true, confidence = .99 });
        Assert.True(DirectToolAuthorization.Parse(raw, .9));
        Assert.True(DirectToolAuthorization.Parse("```json\n" + raw + "\n```", .9));
    }

    [Theory]
    [InlineData(false, .99)]
    [InlineData(true, .5)]
    [InlineData(true, 1.1)]
    public void Rejection_or_uncertainty_does_not_authorize_an_action(bool authorized, double confidence)
        => Assert.False(DirectToolAuthorization.Parse(JsonSerializer.Serialize(new { authorized, confidence }), .9));
}

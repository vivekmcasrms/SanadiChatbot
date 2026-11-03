using System.Text.Json.Nodes;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class AssistantEvidenceSafetyTests
{
    [Fact]
    public void Fuzzy_ranking_rewards_close_query_terms_without_embeddings()
    {
        var relevant = AssistantEvidenceSafety.Rank(
            "registration requirements", "Registration requirement", "Students must meet the listed requirements.", .4m);
        var unrelated = AssistantEvidenceSafety.Rank(
            "registration requirements", "Library opening hours", "The library closes in the evening.", .4m);
        Assert.True(relevant > unrelated);
    }

    [Fact]
    public void Unsupported_numbers_are_removed_from_a_grounded_answer()
    {
        var result = AssistantEvidenceSafety.Validate(
            "Registration closes after 99 days. You can review the registration policy.",
            ["The registration policy says the add and drop period lasts 5 working days."]);
        Assert.False(result.Passed);
        Assert.Contains("99 days", result.UnsupportedClaims.Single());
        Assert.DoesNotContain("99", result.CleanedAnswer);
    }

    [Fact]
    public void Exact_evidence_backed_requirement_passes()
    {
        var result = AssistantEvidenceSafety.Validate(
            "You must complete 30 credit hours.",
            ["Students must complete 30 credit hours before applying."]);
        Assert.True(result.Passed);
        Assert.Equal(1m, result.Score);
    }

    [Fact]
    public void Concurrent_state_merge_keeps_committed_change_and_unrelated_new_change()
    {
        var conversation = Guid.NewGuid();
        var user = Guid.NewGuid();
        var at = DateTimeOffset.UtcNow;
        var basis = State(new JsonObject { ["appointmentContext"] = new JsonObject { ["step"] = 1 } }, 1);
        var current = State(new JsonObject
        {
            ["appointmentContext"] = new JsonObject { ["step"] = 2 },
            ["activeCaseReference"] = "CASE-1"
        }, 2);
        var proposed = State(new JsonObject
        {
            ["appointmentContext"] = new JsonObject { ["step"] = 3 },
            ["textbookContext"] = new JsonObject { ["course"] = "COMP101" }
        }, 2);

        var merged = AssistantConversationStateStore.Merge(basis, current, proposed);

        Assert.Equal(2, merged.Entities["appointmentContext"]!["step"]!.GetValue<int>());
        Assert.Equal("CASE-1", merged.Entities["activeCaseReference"]!.GetValue<string>());
        Assert.Equal("COMP101", merged.Entities["textbookContext"]!["course"]!.GetValue<string>());
        Assert.Equal(3, merged.TurnCount);
        Assert.Contains("appointmentContext", merged.Entities["stateConflicts"]!.AsArray().Select(x => x!.GetValue<string>()));
        return;

        AssistantConversationStateStore.State State(JsonObject entities, int turns) => new(
            Guid.NewGuid(), conversation, user, "Turn", entities, new JsonArray(), null, null,
            "orchestrator", "en", "none", turns, at);
    }
}

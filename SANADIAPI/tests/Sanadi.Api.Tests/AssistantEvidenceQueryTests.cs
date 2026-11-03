using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class AssistantEvidenceQueryTests
{
    [Fact]
    public void Research_overview_searches_the_named_subject() =>
        Assert.Equal<string>(["research"], AssistantEvidenceQuery.Terms("Explain more about UAEU Research Policies"));

    [Theory]
    [InlineData("Explain more about UAEU Research Policies")]
    [InlineData("Tell me about housing policies")]
    [InlineData("Summarize the research policy")]
    public void Named_policy_overviews_are_ready_for_retrieval(string text) =>
        Assert.True(AssistantEvidenceQuery.IsNamedPolicyOverview(text));

    [Theory]
    [InlineData("Explain the policy")]
    [InlineData("Explain these policies")]
    [InlineData("Give me an overview of UAEU policies")]
    [InlineData("I have a problem with research policies")]
    [InlineData("I want to suggest changing the research policy")]
    [InlineData("Tell me about it")]
    public void Ambiguous_questions_and_concerns_keep_intake_routing(string text) =>
        Assert.False(AssistantEvidenceQuery.IsNamedPolicyOverview(text));

    [Fact]
    public void Campus_question_searches_subject_instead_of_generic_question_words() =>
        Assert.Equal<string>(["campus", "entry", "permit"], AssistantEvidenceQuery.Terms("Do I need to apply for a campus entry permit?"));

    [Fact]
    public void Other_topics_are_not_mapped_to_a_fixed_service() =>
        Assert.Equal<string>(["fees", "payment", "plans"], AssistantEvidenceQuery.Terms("Please tell me about fees and payment plans"));

    [Fact]
    public void Arabic_question_keeps_the_actual_topic() =>
        Assert.Equal<string>(["تصريح", "دخول", "الحرم"], AssistantEvidenceQuery.Terms("هل أحتاج إلى تقديم طلب تصريح دخول الحرم؟"));

    [Fact]
    public void Generic_question_does_not_match_every_document() =>
        Assert.Empty(AssistantEvidenceQuery.Terms("Can you tell me about the university services?"));
}

using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class SuggestionChatFlowTests
{
    [Theory]
    [InlineData("I think the university should work with more technology companies to give students better internship opportunities and placements.",true)]
    [InlineData("It would be helpful if career counselling stayed open later during recruitment season.",true)]
    [InlineData("The university should create more internship opportunities.",true)]
    [InlineData("We need stronger industry partnerships.",true)]
    [InlineData("You should extend the appointment booking window to two weeks.",true)]
    [InlineData("Why doesn't the university offer online advising?",true)]
    [InlineData("I have a suggestion about the student portal.",true)]
    [InlineData("Please consider adding more parking spaces.",true)]
    [InlineData("أقترح أن تتعاون الجامعة مع شركات تقنية أكثر لتوفير فرص تدريب للطلبة.",true)]
    [InlineData("أقترح أن تتعاون الجامعة مع عدد أكبر من شركات التقنية لتوفير فرص تدريب وتوظيف أفضل للطلبة.",true)]
    [InlineData("يا ليت المكتبة تفتح يوم السبت",true)]
    [InlineData("What kind of jobs would suit my degree and skills?",false)]
    [InlineData("Book me a career counselling appointment",false)]
    [InlineData("How do I apply for an internship?",false)]
    [InlineData("It would be helpful if you could fix my hold",false)]
    [InlineData("Can you review my CV for technology companies?",false)]
    [InlineData("",false)]
    public void Matches_original_institutional_feedback_detection(string text,bool expected)
        => Assert.Equal(expected,SuggestionChatFlow.IsSuggestion(text));

    [Fact]
    public void Acknowledges_suggestion_without_claiming_submission()
    {
        var answer=SuggestionChatFlow.Answer("More partnerships","Configured unit","en",true);
        Assert.Contains("More partnerships",answer);
        Assert.Contains("Configured unit",answer);
        Assert.Contains("Submit this suggestion",answer);
        Assert.Contains("Nothing is submitted until you approve",answer);
        Assert.DoesNotContain("Submit this suggestion",SuggestionChatFlow.Answer("Proposal","Unit","en",false));
    }
}

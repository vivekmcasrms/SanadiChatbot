using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class ComplaintChatFlowTests
{
    [Theory]
    [InlineData("The buses are always late, and today I had to walk all the way back to my hostel",true)]
    [InlineData("My bus didn't arrive today",true)]
    [InlineData("The shuttle was very late again",true)]
    [InlineData("The internet is not working",true)]
    [InlineData("الحافلات تتأخر كل يوم",true)]
    [InlineData("الحافلات دائماً تتأخر، واليوم اضطررت أمشي إلى السكن.",true)]
    [InlineData("When is the last bus to my hostel?",false)]
    [InlineData("What if the bus is late?",false)]
    [InlineData("Where can I find a textbook about transport?",false)]
    [InlineData("What jobs suit my skills?",false)]
    [InlineData("I submitted my coursework late",false)]
    public void Detects_reported_failures_without_intercepting_normal_questions(string text,bool expected)
        => Assert.Equal(expected,ComplaintChatFlow.IsServiceComplaint(text));

    [Theory]
    [InlineData("I have a problem choosing my courses",false)]
    [InlineData("I have an issue with my degree plan",false)]
    [InlineData("I want to make a complaint about the bus",true)]
    [InlineData("The shuttle is not working",true)]
    public void Selects_complaint_agent_only_for_complaints_or_reported_service_failures(string text,bool expected)
        => Assert.Equal(expected,ComplaintChatFlow.IsComplaintIntent(text));

    [Fact]
    public void Response_prepares_a_complaint_without_claiming_it_was_submitted()
    {
        var answer=ComplaintChatFlow.Answer("Configured transport unit","en",true);
        Assert.Contains("Configured transport unit",answer);
        Assert.Contains("Submit this complaint",answer);
        Assert.Contains("Nothing is submitted until you approve",answer);
        Assert.DoesNotContain("could not find",answer);
        Assert.DoesNotContain("Submit this complaint",ComplaintChatFlow.Answer("Unit","en",false));
    }
}

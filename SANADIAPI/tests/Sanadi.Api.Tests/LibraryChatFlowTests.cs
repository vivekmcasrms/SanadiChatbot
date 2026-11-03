using Sanadi.Api.AI;
using Sanadi.Infrastructure.Library;

namespace Sanadi.Api.Tests;

public sealed class LibraryChatFlowTests
{
    [Theory]
    [InlineData("Find resources similar to \"Schaum's outline of theory and problems of feedback and control systems\"", "Schaum's outline of theory and problems of feedback and control systems")]
    [InlineData("Find resources similar to \"Algebraic methods for nonlinear control systems\"", "Algebraic methods for nonlinear control systems")]
    [InlineData("Find resources similar to \"Fire safety: problems and ideas\"", "Fire safety: problems and ideas")]
    [InlineData("Find resources similar to \"An introduction to \"control\"\"", "An introduction to \"control\"")]
    [InlineData("ابحث عن مصادر مشابهة لـ \"مشكلات التحكم\"", "مشكلات التحكم")]
    [InlineData("Find resources similar to “Control systems”", "Control systems")]
    public void Similar_button_treats_the_entire_title_as_catalogue_data(string text,string title)
    {
        Assert.Equal(title,LibraryChatFlow.SimilarQuery(text));
        Assert.Equal(title,LibraryChatFlow.Query(text));
    }

    [Theory]
    [InlineData("I have a problem with the library")]
    [InlineData("Find resources similar to \"Control systems\". I want to complain about the library.")]
    [InlineData("I suggest adding a Find resources similar to \"Control systems\" button")]
    [InlineData("Find resources similar to \" \"")]
    public void Similar_button_override_does_not_capture_other_messages(string text)
        => Assert.Null(LibraryChatFlow.SimilarQuery(text));

    [Theory]
    [InlineData("Can you find me a good book on control systems?","control systems")]
    [InlineData("Find resources similar to \"Modern Control Engineering\"","Modern Control Engineering")]
    [InlineData("Recommend books about deep learning","deep learning")]
    [InlineData("Find journal articles on solar energy","solar energy")]
    [InlineData("ابحث عن كتاب حول أنظمة التحكم","أنظمة التحكم")]
    [InlineData("ساعدني في العثور على كتاب في الذكاء الاصطناعي.","الذكاء الاصطناعي")]
    [InlineData("Help me find a book on artificial intelligence.","artificial intelligence")]
    [InlineData("مصادر حول الطاقة المتجددة","الطاقة المتجددة")]
    [InlineData("كتاب عن علم الأحياء","علم الأحياء")]
    [InlineData("ممكن تبحث لي عن كتاب جيد عن أنظمة التحكم؟","أنظمة التحكم")]
    [InlineData("ابحث عن مصادر مشابهة لـ \"أنظمة التحكم\"","أنظمة التحكم")]
    [InlineData("Where is my textbook for HIST120?",null)]
    [InlineData("Book me an appointment",null)]
    [InlineData("What are the library opening hours?",null)]
    [InlineData("How do I renew borrowed books?",null)]
    public void Routes_searches_and_preserves_the_complete_topic(string text,string? expected) => Assert.Equal(expected,LibraryChatFlow.Query(text));

    private static LibrarySearchResultDto Result(string title) => new() {status="ok",provider="Configured catalogue",total=42,results=[new() {
        id="record-1",title=title,authors=["Author"],year=2020,type="book",availability="unknown",catalogueUrl="https://catalogue.example.test/record/1" }]};

    [Fact]
    public void Card_preserves_live_metadata_and_does_not_invent_availability()
    {
        var reply=LibraryChatFlow.Build("control systems",Result("Modern Control Systems"),"en");
        Assert.True(reply.Verified);
        Assert.Equal(42,(int)reply.Card!["totalMatches"]!);
        Assert.Equal("record-1",(string?)reply.Card["results"]![0]!["id"]);
        Assert.Equal("Unknown",(string?)reply.Card["results"]![0]!["availabilityLabel"]);
        Assert.Equal("https://catalogue.example.test/record/1",(string?)reply.Card["results"]![0]!["catalogueUrl"]);
        Assert.Null(reply.Card["results"]![0]!["shelf"]);
        Assert.Contains("I found catalogue results",reply.Answer);
    }

    [Fact]
    public void Broad_control_result_is_not_claimed_as_an_exact_engineering_match()
    {
        var reply=LibraryChatFlow.Build("control systems",Result("Chronic disease epidemiology, prevention, and control"),"en");
        Assert.Contains("could not confirm an exact topic match",reply.Answer);
        Assert.NotNull(reply.Card);
    }

    [Theory]
    [InlineData("disabled")]
    [InlineData("unavailable")]
    [InlineData("error")]
    public void Failure_is_not_reported_as_zero_results_or_missing_university_policy(string status)
    {
        var reply=LibraryChatFlow.Build("control systems",new() {status=status},"en");
        Assert.False(reply.Verified);Assert.Null(reply.Card);
        Assert.Contains("cannot reach the live library catalogue",reply.Answer);
        Assert.DoesNotContain("no results",reply.Answer);
        Assert.DoesNotContain("approved university source",reply.Answer);
    }

    [Fact]
    public void Successful_empty_search_is_truthful()
    {
        var reply=LibraryChatFlow.Build("control systems",new() {status="empty"},"en");
        Assert.True(reply.Verified);Assert.Null(reply.Card);
        Assert.Contains("returned no results",reply.Answer);
    }
}

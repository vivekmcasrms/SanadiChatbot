using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class CourseTextbookFlowTests
{
    private static readonly CourseTextbookFlow.Course[] Courses =
    [new("HIST120", "UAE Society and History", "مجتمع الإمارات وتاريخه"),
     new("ETHC201", "Professional Ethics", "الأخلاقيات المهنية"),
     new("CSBP270", "Responsible Artificial Intelligence", "الذكاء الاصطناعي المسؤول")];

    [Theory]
    [InlineData("Where can I find the textbook for CSBP301 — Artificial Intelligence course?")]
    [InlineData("Where is my textbook for HIST120?")]
    [InlineData("Do I have the textbook for my AI course?")]
    [InlineData("أين أجد كتاب مقرر HIST120؟")]
    [InlineData("وين أقدر ألقى كتاب مقرر الذكاء الاصطناعي؟")]
    public void Detects_existing_textbook_questions(string text) => Assert.True(CourseTextbookFlow.IsQuestion(text));

    [Theory]
    [InlineData("Find me a good book on deep learning")]
    [InlineData("Book me an appointment")]
    [InlineData("Find another textbook for HIST120")]
    public void Other_requests_keep_their_own_route(string text) => Assert.False(CourseTextbookFlow.IsQuestion(text));

    [Fact]
    public void Unknown_explicit_course_does_not_choose_a_different_AI_course()
    {
        var reply = CourseTextbookFlow.Build("Where can I find the textbook for CSBP301 — Artificial Intelligence course?", Courses, "en");
        Assert.True(reply.AwaitingCourse);
        Assert.Null(reply.Course);
        Assert.Contains("Which course do you mean?", reply.Answer);
        Assert.Contains("HIST120", reply.Answer);
    }

    [Theory]
    [InlineData("HIST120")]
    [InlineData("hist 120")]
    [InlineData("HIST-120 please")]
    [InlineData("UAE Society and History")]
    public void Accepts_course_selection_and_uses_the_enrollment_title(string text)
    {
        Assert.True(CourseTextbookFlow.IsSelection(text, Courses));
        var reply = CourseTextbookFlow.Build(text, Courses, "en");
        Assert.Equal("HIST120", reply.Course?.Code);
        Assert.Contains("HIST120 — UAE Society and History", reply.Answer);
        Assert.Contains("Blackboard", reply.Answer);
        Assert.Contains("No separate request is needed", reply.Answer);
        Assert.DoesNotContain("http", reply.Answer);
        Assert.False(reply.AwaitingCourse);
    }

    [Theory]
    [InlineData("Hi")]
    [InlineData("What is my grade in HIST120?")]
    [InlineData("Find another book for HIST120")]
    [InlineData("Book me an appointment")]
    public void Previous_textbook_context_does_not_capture_unrelated_turns(string text) =>
        Assert.False(CourseTextbookFlow.IsSelection(text, Courses));

    [Fact]
    public void Course_codes_have_boundaries() => Assert.Null(CourseTextbookFlow.Resolve("HIST1200", Courses));

    [Fact]
    public void Resolves_AI_title_without_an_explicit_conflicting_code() =>
        Assert.Equal("CSBP270", CourseTextbookFlow.Resolve("my AI course", Courses)?.Code);

    [Fact]
    public void Empty_enrollment_is_reported_without_inventing_courses()
    {
        var reply = CourseTextbookFlow.Build("Where is my textbook?", [], "en");
        Assert.False(reply.AwaitingCourse);
        Assert.Null(reply.Course);
        Assert.Contains("don't see any courses registered", reply.Answer);
    }

    [Fact]
    public void Arabic_answer_uses_the_registered_Arabic_title()
    {
        var reply = CourseTextbookFlow.Build("HIST120", Courses, "ar");
        Assert.Contains("مجتمع الإمارات وتاريخه", reply.Answer);
        Assert.Contains("لا تحتاج إلى تقديم أي طلب منفصل", reply.Answer);
    }
}

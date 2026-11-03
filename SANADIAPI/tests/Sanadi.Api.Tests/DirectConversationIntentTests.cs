using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class DirectConversationIntentTests
{
    private static readonly StudentProfileScopePolicy.Tool[] Tools = [new("issue_enrollment_letter", "document")];

    [Theory]
    [InlineData("ساعدني في العثور على كتاب في الذكاء الاصطناعي.", "ar")]
    [InlineData("Help me find a book on artificial intelligence.", "en")]
    [InlineData("Find a book about enrolment letters.", "en")]
    [InlineData("ابحث عن كتاب حول شهادة قيد.", "ar")]
    public void A_wrong_high_confidence_document_selection_cannot_override_a_catalogue_request(string text, string language)
    {
        var wrong = new StudentProfileScopePolicy.Decision(StudentProfileScopePolicy.Scope.SignedInStudent, "issue_enrollment_letter");
        foreach (var voice in new[] { false, true })
        {
            var request = AssistantController.NormalizeTurn(new(text, null, language, null, "mira", voice));
            Assert.Equal("library", AssistantController.DirectConversationRoute(request.Message, request.Lang!, wrong));
        }
    }

    [Theory]
    [InlineData("What is my GPA?", "en")]
    [InlineData("كم معدلي؟", "ar")]
    [InlineData("Where is my textbook for HIST120?", "en")]
    [InlineData("أريد كتاب المقرر HIST120", "ar")]
    public void Existing_profile_and_course_handlers_cannot_be_replaced_by_an_unrelated_document_action(string text, string language)
        => Assert.Null(AssistantController.DirectConversationRoute(text, language,
            new(StudentProfileScopePolicy.Scope.SignedInStudent, "issue_enrollment_letter")));

    [Theory]
    [InlineData("I need an enrolment letter.", "en")]
    [InlineData("أحتاج إلى خطاب التسجيل.", "ar")]
    [InlineData("أريد شهادة القيد.", "ar")]
    [InlineData("ممكن افادة تثبت اني طالب مسجل؟", "ar")]
    [InlineData("أَحْتَاجُ شَهَادَةَ الْقَيْدِ.", "ar")]
    public void Semantic_document_intent_reaches_the_same_existing_handler_in_both_languages(string text, string language)
    {
        var decision = StudentProfileScopePolicy.ParseDecision(
            """{"scope":"signed_in_student","directTool":"issue_enrollment_letter","greetingOnly":false,"intentConfidence":0.99}""", Tools);
        Assert.Equal("document", AssistantController.DirectConversationRoute(text, language, decision));
    }

    [Theory]
    [InlineData("Good afternoon, how are you?", "en")]
    [InlineData("يا هلا وغلا، شحالج؟", "ar")]
    [InlineData("صباح النور يا ميرا", "ar")]
    [InlineData("الله يحييك، كيف يومك؟", "ar")]
    public void Social_intent_uses_the_shared_greeting_handler_without_a_voice_only_branch(string text, string language)
    {
        var decision = StudentProfileScopePolicy.ParseDecision(
            """{"scope":"not_private_data","directTool":null,"greetingOnly":true,"intentConfidence":0.99}""", Tools);
        Assert.Equal("greeting", AssistantController.DirectConversationRoute(text, language, decision));
    }

    [Theory]
    [InlineData("another_person", "issue_enrollment_letter", false, .99)]
    [InlineData("signed_in_student", "unregistered_tool", false, .99)]
    [InlineData("signed_in_student", "issue_enrollment_letter", false, .6)]
    [InlineData("signed_in_student", "issue_enrollment_letter", true, .99)]
    [InlineData("signed_in_student", null, true, .99)]
    public void Untrusted_ambiguous_or_conflicting_intents_do_not_add_a_direct_route(string scope, string? tool, bool greeting, double confidence)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(new { scope, directTool = tool, greetingOnly = greeting, intentConfidence = confidence });
        var decision = StudentProfileScopePolicy.ParseDecision(json, Tools);
        Assert.Null(decision.DirectTool);
        Assert.False(decision.GreetingOnly);
    }

    [Fact]
    public void Optional_intent_data_cannot_erase_another_student_privacy_refusal()
    {
        var decision = StudentProfileScopePolicy.ParseDecision(
            """{"scope":"another_person","directTool":"issue_enrollment_letter","greetingOnly":true,"intentConfidence":"invalid"}""", Tools);
        Assert.Equal(StudentProfileScopePolicy.Scope.AnotherPerson, decision.Scope);
        Assert.Null(AssistantController.DirectConversationRoute("أحتاج خطاب تسجيل لطالب آخر", "ar", decision));
    }

    [Fact]
    public void A_tool_absent_from_the_enabled_catalogue_is_not_selected()
    {
        var decision = StudentProfileScopePolicy.ParseDecision(
            """{"scope":"signed_in_student","directTool":"issue_enrollment_letter","greetingOnly":false,"intentConfidence":0.99}""", []);
        Assert.Null(decision.DirectTool);
    }

    [Theory]
    [InlineData("Hello, what is my GPA?", "en")]
    [InlineData("مرحبا، كم معدلي؟", "ar")]
    [InlineData("Hello, issue my enrolment letter.", "en")]
    [InlineData("مرحبا، أريد إفادة تسجيل.", "ar")]
    public void A_greeting_cannot_override_a_recognized_student_service_request(string text, string language)
    {
        var decision = new StudentProfileScopePolicy.Decision(StudentProfileScopePolicy.Scope.NotPrivateData, GreetingOnly: true);
        Assert.Null(AssistantController.DirectConversationRoute(text, language, decision));
    }

    [Fact]
    public void Old_classifier_response_preserves_existing_routing()
    {
        var decision = StudentProfileScopePolicy.ParseDecision("""{"scope":"signed_in_student"}""", Tools);
        Assert.Null(decision.DirectTool);
        Assert.False(decision.GreetingOnly);
        Assert.True(AssistantController.IsLetterRequest("I need an enrolment letter."));
    }
}

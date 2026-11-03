using System.Text.Json;
using System.Text.Json.Nodes;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class AssistantParityTests
{
    [Theory]
    [InlineData("en", "I need an enrolment letter", "Document Generation Agent")]
    [InlineData("ar", "أحتاج إفادة تسجيل", "وكيل إنشاء الوثائق")]
    public void Shared_working_agent_progress_uses_the_existing_document_routing_and_wire_format(
        string language, string question, string displayName)
    {
        var agent = AssistantController.InitialWorkingAgent(question, language);
        Assert.Equal("document", agent.Key);
        Assert.Equal(displayName, agent.DisplayName);
        Assert.False(string.IsNullOrWhiteSpace(agent.StatusText));
        var json = JsonSerializer.SerializeToNode(agent, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(agent.Key, (string?)json["key"]);
        Assert.Equal(agent.StatusText, (string?)json["statusText"]);
        Assert.Equal(agent, AssistantController.ResolveWorkingAgent("document", language));
    }

    [Theory]
    [InlineData("Can you check my academic status?", "ar", "en")]
    [InlineData("ما هي حالتي الأكاديمية؟", "en", "ar")]
    public void Text_and_voice_normalize_to_the_same_business_turn(
        string message, string selectedLanguage, string expectedLanguage)
    {
        var conversation = Guid.NewGuid();
        var text = AssistantController.NormalizeTurn(new(
            message, conversation, selectedLanguage, new JsonArray(), "mira"));
        var voice = AssistantController.NormalizeTurn(new(
            message, conversation, selectedLanguage, new JsonArray(), "mira", VoicePresentation: true));

        Assert.Equal(text.Message, voice.Message);
        Assert.Equal(expectedLanguage, text.Lang);
        Assert.Equal(text.Lang, voice.Lang);
        Assert.Equal(text.ConversationId, voice.ConversationId);
        Assert.Equal(text.SupportAgent, voice.SupportAgent);
        Assert.False(text.VoicePresentation);
        Assert.False(voice.VoicePresentation);
    }

    [Fact]
    public void Existing_text_turn_fields_are_preserved_by_normalization()
    {
        var conversation = Guid.NewGuid();
        var attachments = new JsonArray(new JsonObject { ["storagePath"] = "private/student/document.pdf" });
        var request = new AssistantController.AskRequest(
            "Where is my document?", conversation, "en", attachments, "suhail");

        var normalized = AssistantController.NormalizeTurn(request);

        Assert.Equal(request.Message, normalized.Message);
        Assert.Equal(request.ConversationId, normalized.ConversationId);
        Assert.Same(attachments, normalized.Attachments);
        Assert.Equal(request.SupportAgent, normalized.SupportAgent);
    }

    [Theory]
    [InlineData("not_private_data", "NotPrivateData")]
    [InlineData("signed_in_student", "SignedInStudent")]
    [InlineData("another_person", "AnotherPerson")]
    [InlineData("unclear", "SignedInStudent")]
    public void Profile_scope_classifier_has_a_language_neutral_closed_schema(
        string value, string expected)
        => Assert.Equal(expected, StudentProfileScopePolicy.Parse($"{{\"scope\":\"{value}\"}}").ToString());

    [Fact]
    public void Another_students_private_record_has_refusals_in_both_languages()
    {
        Assert.Contains("signed in", StudentProfileScopePolicy.Refusal("en"), StringComparison.OrdinalIgnoreCase);
        Assert.Contains("حسابك", StudentProfileScopePolicy.Refusal("ar"), StringComparison.Ordinal);
    }

    [Fact]
    public void Unspecified_account_uses_signed_in_student_while_another_person_stays_refused()
    {
        Assert.Equal(StudentProfileScopePolicy.Scope.SignedInStudent,
            StudentProfileScopePolicy.Parse("{\"scope\":\"unclear\"}"));
        Assert.Equal(StudentProfileScopePolicy.Scope.AnotherPerson,
            StudentProfileScopePolicy.Parse("{\"scope\":\"another_person\"}"));
    }

    [Fact]
    public void Privacy_prompt_does_not_depend_on_the_message_language()
    {
        var english = StudentProfileScopePolicy.Prompt("Request written in English");
        var arabic = StudentProfileScopePolicy.Prompt("طلب مكتوب بالعربية");

        Assert.Contains("Language, grammar and writing system must not change the classification", english);
        Assert.Contains("Language, grammar and writing system must not change the classification", arabic);
        Assert.Contains("another_person", english);
        Assert.Contains("another_person", arabic);
    }

    [Theory]
    [InlineData("query")]
    [InlineData("complaint")]
    [InlineData("suggestion")]
    public void Missing_data_handoff_keeps_the_classified_submission_type(string type)
    {
        var unit = new InteractionUnitRouting.Unit(
            Guid.NewGuid(), "configured", "Configured team", "الجهة", "Configured remit", null);
        var payload = JsonSerializer.Serialize(new
        {
            needsClarification = false,
            question = "",
            type,
            title = "Configured request",
            searchQuery = "Configured request details",
            unitId = unit.Id,
            confidence = .95,
            routingConfidence = .95,
            usePrevious = false
        });

        var decision = ChatConcernPlanner.Parse(payload, [unit], "en");

        Assert.Equal(type, decision.Type);
        Assert.True(decision.CanRoute);
    }
}

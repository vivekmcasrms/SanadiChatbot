using System.Text.Json;
using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class AssistantRoutingTests
{
    [Theory]
    [InlineData("invalid")]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("[\"staff\"]")]
    [InlineData("[\"student\",123]")]
    [InlineData(null)]
    public void Malformed_or_unauthorized_role_policies_cannot_allow_a_student_action(string? roles)
        => Assert.False(AssistantController.Allowed(roles,["student"]));

    [Fact]
    public async Task Unauthenticated_text_and_voice_requests_stop_before_any_routing_or_source_lookup()
    {
        var context = new Microsoft.AspNetCore.Mvc.ControllerContext { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext() };
        var assistant = new AssistantController(null!,null!,null!,null!,null!,Microsoft.Extensions.Logging.Abstractions.NullLogger<AssistantController>.Instance) { ControllerContext = context };
        var voice = new VoiceAssistantController(assistant,Microsoft.Extensions.Logging.Abstractions.NullLogger<VoiceAssistantController>.Instance) { ControllerContext = context };
        await Assert.ThrowsAsync<Sanadi.Domain.Exceptions.UnauthorizedException>(() => assistant.Ask(new("My profile",null,"en",null),default));
        await Assert.ThrowsAsync<Sanadi.Domain.Exceptions.UnauthorizedException>(() => voice.Ask(new("ملفي",null,"ar"),default));
    }

    // Test utterances only. Production routing uses the typed intent catalogue, never this corpus.
    public static TheoryData<string, string, string, string> Requests => new()
    {
        { "document", "I need proof of my enrolment.", "أحتاج شهادة تثبت تسجيلي في الجامعة.", "أحتاج my enrolment certificate." },
        { "library", "Help me find a book on artificial intelligence.", "ساعدني في العثور على كتاب في الذكاء الاصطناعي.", "ابحث عن book on artificial intelligence." },
        { "textbook", "Where is the prescribed textbook for my course?", "أين الكتاب المقرر للمادة المسجلة؟", "أين textbook المقرر؟" },
        { "appointment", "Arrange a meeting with an academic advisor.", "أريد حجز موعد مع مرشد أكاديمي.", "أريد appointment مع المرشد." },
        { "course_detail", "Who teaches COMP101?", "من يدرس مقرر COMP101؟", "من هو instructor في COMP101؟" },
        { "current_courses", "List my current courses.", "اعرض مقرراتي الحالية.", "اعرض current courses الخاصة بي." },
        { "identity", "What is my student number?", "ما هو رقمي الجامعي؟", "ما هو my student ID؟" },
        { "academic_status", "What is my GPA?", "كم معدلي التراكمي؟", "كم my GPA؟" },
        { "graduation", "How close am I to graduation?", "كم بقي لي حتى التخرج؟", "كم بقي لي على graduation؟" },
        { "completed_courses", "Which courses have I completed?", "ما المقررات التي أكملتها؟", "اعرض completed courses الخاصة بي." },
        { "remaining_courses", "Which courses do I still need to complete?", "ما المقررات المتبقية لي؟", "ما remaining courses لدي؟" },
        { "campus_entry", "Do I need a campus parking permit?", "هل أحتاج تصريح دخول لمواقف الجامعة؟", "هل أحتاج campus parking permit؟" },
        { "campus_entry_problem", "My student card will not open the campus gate.", "بطاقتي الجامعية لا تفتح بوابة الحرم.", "بطاقتي لا تفتح campus gate." },
        { "career_matches", "Which careers suit my degree?", "ما الوظائف المناسبة لتخصصي؟", "ما career matches المناسبة لتخصصي؟" },
        { "career_ats", "Check my CV's ATS score.", "احسب درجة سيرتي الذاتية في نظام الفرز.", "احسب ATS score لسيرتي." },
        { "career_cv_review", "Review my CV.", "راجع سيرتي الذاتية.", "راجع my CV." },
        { "career_skill_gap", "What skills am I missing for employment?", "ما المهارات التي تنقصني للعمل؟", "ما skill gaps لدي للعمل؟" },
        { "career_readiness", "Am I ready to apply for jobs?", "هل أنا جاهز للتقديم على الوظائف؟", "هل أنا ready to apply for jobs؟" },
        { "complaint", "I want to complain about repeated bus delays.", "أريد تقديم شكوى عن تأخر الحافلات المتكرر.", "أريد complaint عن تأخر الحافلة." },
        { "suggestion", "I suggest extending library opening hours.", "أقترح تمديد ساعات عمل المكتبة.", "أقترح تمديد library opening hours." },
        { "inquiry", "Please submit an enquiry about my unanswered fee question.", "أريد تقديم استفسار عن سؤالي حول الرسوم الذي لم تتم الإجابة عنه.", "أريد submit an enquiry عن الرسوم." },
        { "alert", "There is a fire on campus and people need help now.", "هناك حريق في الحرم والناس يحتاجون مساعدة الآن.", "هناك fire في الحرم ونحتاج مساعدة الآن." },
        { "campus_incident", "The air conditioner in my dorm room is broken.", "المكيف في غرفتي بالسكن لا يعمل.", "المكيف في dorm room لا يعمل." },
        { "greeting", "Hello, how are you?", "مرحباً، كيف حالك؟", "Hello ميرا، كيف حالك؟" },
        { "knowledge", "Explain the university's assessment policy.", "اشرح سياسة التقييم في الجامعة.", "اشرح assessment policy للجامعة." },
        { "clarify", "I need that thing sorted out.", "أحتاج حل ذلك الموضوع.", "أحتاج fix that thing." }
    };

    private static StudentProfileScopePolicy.Decision Understood(params string[] intents) => new(
        StudentProfileScopePolicy.Scope.SignedInStudent,
        intents.Contains("document") ? "issue_enrollment_letter" : null, Routing: new(intents));

    [Theory, MemberData(nameof(Requests))]
    public void Equivalent_EN_AR_and_mixed_inputs_share_the_same_route_and_ignore_channel(
        string intent, string english, string arabic, string mixed)
    {
        foreach (var message in new[] { english, arabic, mixed })
        foreach (var voice in new[] { false, true })
        {
            var input = AssistantController.NormalizeTurn(new(message, null, "en", null, VoicePresentation:voice));
            var normalized = AssistantRouting.Normalize(input.Message);
            var json = JsonSerializer.Serialize(new { scope = "signed_in_student", directTool = intent == "document" ? "issue_enrollment_letter" : null,
                routingIntents = new[] { intent }, intentConfidence = .99, continueWorkflow = false });
            var understood = StudentProfileScopePolicy.ParseDecision(json, [new("issue_enrollment_letter", "document", "Enrolment certificate")]);
            var result = AssistantRouting.Resolve(understood, AssistantController.RoutingCandidates(normalized, understood));
            Assert.Equal(intent, result.Intent);
            Assert.Equal(message, normalized.Original);
        }
    }

    [Fact]
    public void Every_supported_semantic_intent_has_a_bilingual_fixture()
    {
        var covered = Requests.Select(r => (string)r[0]).Append("privacy").Order().ToArray();
        Assert.Equal(AssistantRouting.Definitions.Select(d => d.Intent).Order(), covered);
    }

    [Theory]
    [InlineData("Find a book about enrolment letters.", "library")]
    [InlineData("أين أجد كتاباً عن الشبكات؟", "library")]
    [InlineData("Do not issue a certificate; explain the rules.", "knowledge")]
    [InlineData("لا تصدر شهادة، اشرح الشروط فقط.", "knowledge")]
    [InlineData("Hello, explain the fee policy.", "knowledge")]
    [InlineData("مرحبا، اشرح سياسة الرسوم.", "knowledge")]
    [InlineData("Find a book about fire safety.", "library")]
    public void Meaning_overrules_incidental_words_negation_and_greeting_prefix(string message, string intent)
    {
        var understood = Understood(intent);
        Assert.Equal(intent, AssistantRouting.Resolve(understood,
            AssistantController.RoutingCandidates(AssistantRouting.Normalize(message), understood)).Intent);
    }

    [Theory]
    [InlineData("library", "document")]
    [InlineData("appointment", "textbook")]
    [InlineData("complaint", "suggestion")]
    public void Equal_priority_conflicts_clarify_independently_of_order(string first, string second)
    {
        var forward = AssistantRouting.Resolve(Understood(first,second), []);
        var reverse = AssistantRouting.Resolve(Understood(second,first), []);
        Assert.Equal("clarify", forward.Handler);
        Assert.Equal(forward.Handler, reverse.Handler);
        Assert.Equal("conflicting_outcomes", forward.Reason);
        Assert.Equal(2, forward.Rejected.Length);
    }

    [Fact]
    public void Privacy_and_safety_precede_specialists_and_conversation()
    {
        Assert.Equal("privacy", AssistantRouting.Resolve(Understood("document") with { Scope = StudentProfileScopePolicy.Scope.AnotherPerson }, []).Handler);
        Assert.Equal("alert", AssistantRouting.Resolve(Understood("document","alert","greeting"), []).Handler);
        Assert.Equal("document", AssistantRouting.Resolve(Understood("document","identity","greeting"), []).Handler);
        Assert.Equal("clarify", AssistantRouting.Resolve(Understood("document","clarify"), []).Handler);
    }

    [Fact]
    public void A_generic_information_label_cannot_shadow_an_existing_proactive_service_contract()
    {
        Assert.Equal("proactive",AssistantRouting.Resolve(Understood("knowledge"),[new("campus_entry","existing_service")]).Handler);
        Assert.Equal("knowledge",AssistantRouting.Resolve(Understood("knowledge"),[new("document","incidental_word")]).Handler);
    }

    [Fact]
    public void Disabled_unconfirmed_or_unavailable_document_selection_cannot_issue()
    {
        foreach (var decision in new[] { Understood("document") with { DirectTool = null },
            new StudentProfileScopePolicy.Decision(StudentProfileScopePolicy.Scope.Unavailable) })
            Assert.Equal("clarify", AssistantRouting.Resolve(decision, [new("document","legacy")]).Handler);
    }

    [Theory]
    [InlineData("Help me find a book on artificial intelligence.")]
    [InlineData("ساعدني في العثور على كتاب في الذكاء الاصطناعي.")]
    public void Even_a_wrong_confirmed_model_action_cannot_override_an_existing_lookup(string text)
    {
        var mistaken = Understood("document");
        var result = AssistantRouting.Resolve(mistaken,AssistantController.RoutingCandidates(AssistantRouting.Normalize(text),mistaken));
        Assert.Equal("clarify",result.Handler);
        Assert.Equal("action_route_conflict",result.Reason);
    }

    [Fact]
    public void Pending_workflow_owns_its_reply_but_not_a_new_topic()
    {
        Assert.Equal("textbook", AssistantRouting.Resolve(Understood("course_detail") with { Routing = new(["course_detail"],ContinueWorkflow:true) }, [], "textbook").Handler);
        Assert.Equal("appointment", AssistantRouting.Resolve(Understood("appointment") with { Routing = new(["appointment"],ContinueWorkflow:true) }, [], "appointment").Handler);
        Assert.Equal("profile", AssistantRouting.Resolve(Understood("academic_status"), [], "appointment").Handler);
        Assert.Equal("alert", AssistantRouting.Resolve(Understood("alert") with { Routing = new(["alert"],ContinueWorkflow:true) }, [], "appointment").Handler);
        Assert.Equal("library", AssistantRouting.Resolve(Understood("library") with { Routing = new(["library"],ContinueWorkflow:true) }, [], "inquiry").Handler);
    }

    [Theory]
    [InlineData("What skills am I missing for those jobs?")]
    [InlineData("ما المهارات التي تنقصني لتلك الوظائف؟")]
    [InlineData("ما skills التي تنقصني لتلك jobs؟")]
    public void A_continuation_flag_cannot_replace_a_recognized_service_question(string message)
    {
        foreach (var pending in new[] { "appointment", "textbook", "inquiry", "alert" })
        foreach (var lang in new[] { "en", "ar" })
        foreach (var voice in new[] { false, true })
        {
            var turn = AssistantController.NormalizeTurn(new(message,null,lang,null,VoicePresentation:voice));
            var decision = Understood("career_skill_gap") with { Routing = new(["career_skill_gap"],ContinueWorkflow:true) };
            var route = AssistantRouting.Resolve(decision,
                AssistantController.RoutingCandidates(AssistantRouting.Normalize(turn.Message),decision,pending),pending);
            Assert.Equal("career_skill_gap",route.Intent);
            Assert.False(AssistantRouting.ContinuesWorkflow(route,decision.Routing,pending));
        }
    }

    [Theory]
    [InlineData("academic_status", "profile")]
    [InlineData("career_matches", "career")]
    [InlineData("library", "library")]
    [InlineData("complaint", "concern")]
    public void Pending_appointment_cannot_override_another_specific_outcome(string intent,string handler)
    {
        var decision = Understood(intent) with { Routing = new([intent],ContinueWorkflow:true) };
        Assert.Equal(handler,AssistantRouting.Resolve(decision,[],"appointment").Handler);
    }

    [Theory]
    [InlineData("appointment", "appointment")]
    [InlineData("knowledge", "appointment")]
    [InlineData("course_detail", "textbook")]
    [InlineData("complaint", "inquiry")]
    public void Genuine_workflow_replies_keep_their_existing_context(string intent,string pending)
    {
        var decision = Understood(intent) with { Routing = new([intent],ContinueWorkflow:true) };
        var route = AssistantRouting.Resolve(decision,[],pending);
        Assert.True(AssistantRouting.ContinuesWorkflow(route,decision.Routing,pending));
    }

    [Fact]
    public void Low_confidence_and_malformed_routing_fail_closed_without_losing_privacy()
    {
        foreach (var raw in new[] { "[]", "[\"unknown_tool\"]", "null", "[123]" })
        {
            var decision = StudentProfileScopePolicy.ParseDecision("{\"scope\":\"another_person\",\"intentConfidence\":0.99,\"routingIntents\":"+raw+"}", []);
            Assert.Equal("privacy", AssistantRouting.Resolve(decision, []).Handler);
        }
        var low = StudentProfileScopePolicy.ParseDecision("{\"scope\":\"signed_in_student\",\"intentConfidence\":0.5,\"routingIntents\":[\"document\"]}", []);
        Assert.Equal("clarify", AssistantRouting.Resolve(low, []).Handler);
    }

    [Fact]
    public void Unicode_matching_view_removes_diacritics_and_direction_controls_without_mutating_original()
    {
        const string raw = "\u202eأَحْتَاجُ\u202c كـتاب  ＡＩ";
        var value = AssistantRouting.Normalize(raw);
        Assert.Equal(raw, value.Original);
        Assert.Equal("احتاج كتاب AI", value.Normalized);
        Assert.Equal("mixed", value.DetectedLanguage);
        Assert.Equal("\ufffd",AssistantRouting.Normalize("\ud800").Normalized);
    }

    [Fact]
    public void Registry_rejects_duplicate_contradictory_unreachable_and_shadowed_definitions()
    {
        var definitions = AssistantRouting.Definitions;
        Assert.Throws<InvalidOperationException>(() => AssistantRouting.Build(definitions.Append(definitions[0])));
        Assert.Throws<InvalidOperationException>(() => AssistantRouting.Build(definitions.Append(definitions[0] with { Handler = "library" })));
        Assert.Throws<InvalidOperationException>(() => AssistantRouting.Build(definitions.Append(new("invalid","missing_handler",AssistantRouting.Priority.Business,"Invalid"))));
        Assert.Throws<InvalidOperationException>(() => AssistantRouting.Build(definitions.Select(d => d.Intent == "knowledge" ? d with { Priority = AssistantRouting.Priority.Safety } : d)));
        Assert.Throws<InvalidOperationException>(() => AssistantRouting.Build(definitions.Where(d => d.Intent != "privacy")));
        Assert.Throws<InvalidOperationException>(() => StudentProfileScopePolicy.ValidateTools([new("tool","query"),new("TOOL","document")]));
        Assert.Throws<InvalidOperationException>(() => StudentProfileScopePolicy.ValidateTools([new("","query")]));
    }
}

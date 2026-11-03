using System.Text.Json.Nodes;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class VoiceReplyNarrationTests
{
    [Theory]
    [InlineData("en", "verified")]
    [InlineData("ar", "verified")]
    [InlineData("en", "fallbackUsed")]
    [InlineData("ar", "fallbackUsed")]
    [InlineData("en", "humanHandoff")]
    [InlineData("ar", "humanHandoff")]
    [InlineData("en", "error")]
    [InlineData("ar", "error")]
    [InlineData("en", "clarifyingQuestion")]
    [InlineData("ar", "clarifyingQuestion")]
    public void Question_focus_cannot_remove_a_failure_or_uncertainty_notice(string language, string flag)
    {
        var opening = language == "ar" ? "لا يمكنني التحقق من هذه المعلومات." : "I could not verify this information.";
        var detail = language == "ar" ? "موضوعك هو رقم الطالب. تتوفر المساعدة في البوابة. يمكنك التواصل مع خدمات الطلبة."
            : "Your topic is the student ID. Help is available in the portal. You can contact Student Services.";
        var result = Result(opening + " " + detail);
        if (flag == "error") result["responseType"] = "error";
        else if (flag == "clarifyingQuestion") result[flag] = "Clarification required";
        else result[flag] = flag != "verified";
        var original = result.ToJsonString();
        Assert.StartsWith(opening, VoiceReplyNarration.Overview(result, "Student ID رقم الطالب", language));
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "What is my student ID?", "Student ID", "Account balance", "What is my account balance?",
        "Your account contains information about the university services available through the student portal")]
    [InlineData("ar", "ما هو رقم الطالب؟", "رقم الطالب", "رصيد الحساب", "ما هو رصيد الحساب؟",
        "يحتوي حسابك على معلومات عن خدمات الجامعة المتاحة للطالب من خلال البوابة الإلكترونية")]
    public void Completed_summary_reserves_space_for_the_question_before_a_long_generic_opening(
        string language, string idQuestion, string idLabel, string balanceLabel, string balanceQuestion, string generic)
    {
        var opening = string.Join(" ", Enumerable.Repeat(generic, 5)) + ".";
        var result = Result($"{opening}\n- **{idLabel}:** 009876543\n- **{balanceLabel}:** 125.50\n{generic}.");
        var original = result.ToJsonString();

        var idSummary = VoiceReplyNarration.Overview(result, idQuestion, language);
        var balanceSummary = VoiceReplyNarration.Overview(result, balanceQuestion, language);

        Assert.Contains(idLabel, idSummary);
        Assert.Contains("009876543", idSummary);
        Assert.DoesNotContain("125.50", idSummary);
        Assert.Contains(balanceLabel, balanceSummary);
        Assert.Contains("125.50", balanceSummary);
        Assert.DoesNotContain("009876543", balanceSummary);
        foreach (var summary in new[] { idSummary, balanceSummary })
            Assert.InRange(System.Text.RegularExpressions.Regex.Matches(summary, @"\S+").Count, 1, 45);
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "What is my GPA and student ID?", "Student ID", "GPA", "The portal provides university information")]
    [InlineData("ar", "ما هو رقم الطالب والمعدل؟", "رقم الطالب", "المعدل", "تعرض البوابة معلومات خدمات الجامعة")]
    public void Multiple_requested_values_survive_the_summary_without_becoming_values_from_the_question(
        string language, string question, string idLabel, string gpaLabel, string generic)
    {
        var opening = string.Join(" ", Enumerable.Repeat(generic, 12)) + ".";
        var result = Result($"{opening}\n- **{idLabel}:** 009876543\n- **{gpaLabel}:** 3.75\n{generic}.");
        var summary = VoiceReplyNarration.Overview(result, question + " 999999999", language);
        Assert.Contains("009876543", summary);
        Assert.Contains("3.75", summary);
        Assert.DoesNotContain("999999999", summary);
    }

    [Theory]
    [InlineData("en", "Am I eligible?", "Your profile contains general information about the services available through the university",
        "You meet the academic requirement.", "However, you are not eligible until residency is verified.")]
    [InlineData("ar", "هل أنا مؤهل؟", "يتضمن حسابك معلومات عامة عن الخدمات المتاحة عبر البوابة الإلكترونية للجامعة",
        "أنت تستوفي الشروط الأكاديمية.", "لكن لست مؤهل حتى يتم التحقق من الإقامة.")]
    public void A_requested_detail_keeps_its_qualification_when_the_generic_opening_is_omitted(
        string language, string question, string generic, string statement, string qualification)
    {
        var opening = string.Join(" ", Enumerable.Repeat(generic, 6)) + ".";
        var summary = VoiceReplyNarration.Overview(Result($"{opening} {statement} {qualification}"), question, language);
        Assert.Contains(statement, summary);
        Assert.Contains(qualification, summary);
        Assert.DoesNotContain(opening, summary);
    }

    [Theory]
    [InlineData("en", "Verified source detail")]
    [InlineData("ar", "تفصيل من المصدر المعتمد")]
    public void Three_long_paragraphs_are_summarized_from_the_response_not_read_in_full(string language, string words)
    {
        var paragraph = string.Join(" ", Enumerable.Repeat(words, 18)) + ".";
        var answer = string.Join("\n", Enumerable.Repeat(paragraph, 3));
        var result = Result(answer);
        var original = result.ToJsonString();
        var spoken = VoiceReplyNarration.Overview(result, "", language);
        Assert.True(spoken.Length < VoiceSpeechFormatter.ToSpeech(answer, language).Length);
        Assert.InRange(System.Text.RegularExpressions.Regex.Matches(spoken, @"\S+").Count, 1, 110);
        Assert.Equal(original, result.ToJsonString());
        Assert.All(VoiceReplyNarration.Select(answer, "", language), part => Assert.Contains(part.Text, answer));
    }

    private static JsonObject Result(string answer, params string[] tools) => new()
    {
        ["answer"] = answer,
        ["toolsUsed"] = new JsonArray(tools.Select(t => (JsonNode?)JsonValue.Create(t)).ToArray()),
        ["proposedActions"] = new JsonArray(),
        ["nextSteps"] = new JsonArray("On-screen next step"),
        ["conversationId"] = "existing-conversation"
    };

    [Theory]
    [InlineData("en", "How do I request my letter?",
        "**You can request your letter.** The portal has a blue menu. Several services are listed. " +
        "Each service has its own page. The home page has background information. " +
        "The fee is AED 50. You must apply before 25 October 2026. Download the letter after approval.",
        "You can request your letter. The fee is AED 50. You must apply before 25 October 2026. Download the letter after approval.")]
    [InlineData("ar", "كيف أطلب الخطاب؟",
        "**تقدر تطلب الخطاب.** تحتوي البوابة على قائمة جانبية. توجد خدمات عديدة. " +
        "لكل خدمة صفحة. تعرض الصفحة الرئيسية معلومات عامة. " +
        "الرسوم 50 درهماً. يجب تقديم الطلب قبل 25 أكتوبر 2026. نزّل الخطاب بعد الموافقة.",
        "تقدر تطلب الخطاب. الرسوم 50 درهماً. يجب تقديم الطلب قبل 25 أكتوبر 2026. نزّل الخطاب بعد الموافقة.")]
    public async Task Final_overview_keeps_source_facts_and_full_text_response_for_both_speech_transports(
        string language, string question, string answer, string expected)
    {
        var result = Result(answer);
        result["citations"] = new JsonArray(new JsonObject { ["id"] = "verified-source" });
        var original = result.ToJsonString();

        var overview = VoiceReplyNarration.Overview(result, question, language);

        Assert.Equal(expected, overview);
        Assert.True(overview.Length < answer.Length);
        // HTTP returns the overview directly; both WebSocket transports split it for TTS.
        foreach (var naturalPhrasing in new[] { false, true })
        {
            var spoken = new List<string>();
            var splitter = new VoiceSentences(language,
                text => { spoken.Add(text); return Task.CompletedTask; },
                firstChunkChars: naturalPhrasing ? 160 : 600, naturalPhrasing: naturalPhrasing);
            await splitter.Push(overview, final: true);
            Assert.Equal(expected, string.Join(" ", spoken));
        }
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "Subject: Transport. Body: The bus was late. It happened on Sunday. The stop was on campus. Please approve submission.")]
    [InlineData("ar", "الموضوع: النقل. التفاصيل: تأخرت الحافلة. حدث ذلك يوم الأحد. كان الموقف داخل الحرم الجامعي. يرجى الموافقة على التقديم.")]
    public void Final_overview_keeps_pending_approval_details(string language, string answer)
    {
        var result = Result(answer);
        result["proposedActions"] = new JsonArray(new JsonObject { ["toolName"] = "create_complaint" });
        var original = result.ToJsonString();

        Assert.Equal(VoiceSpeechFormatter.ToSpeech(answer, language),
            VoiceReplyNarration.Overview(result, "", language));
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "The document could not be issued. Please contact Student Services.")]
    [InlineData("ar", "تعذر إصدار المستند. يرجى التواصل مع خدمات الطلبة.")]
    public void Final_overview_uses_the_final_answer_without_inventing_a_document_outcome(string language, string answer)
    {
        var result = IssuedLetter(language);
        result["answer"] = answer;
        var original = result.ToJsonString();

        Assert.Equal(answer, VoiceReplyNarration.Overview(result, "", language));
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en")]
    [InlineData("ar")]
    public void An_empty_answer_never_creates_spoken_facts(string language)
        => Assert.Empty(VoiceReplyNarration.Overview(new JsonObject(), "", language));

    [Theory]
    [InlineData("en", "Your GPA is 3.", "75. ", "Your academic record has more detail.")]
    [InlineData("ar", "معدلك الحالي 3.", "75. ", "تفاصيل سجلك الأكاديمي موجودة على الشاشة.")]
    public async Task Opening_is_spoken_before_completion_once_without_splitting_numbers(string language, string prefix, string suffix, string rest)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("GPA", language,
            new VoiceSentences(language, s => { audio.Add(s); return Task.CompletedTask; }, 160));
        await narration.Push(prefix);
        Assert.Empty(audio);
        await narration.Push(suffix);
        Assert.Single(audio);
        Assert.EndsWith("3.75.", audio[0]);
        await narration.Push(rest);
        Assert.Single(audio);
        var result = Result(prefix + suffix + rest);
        var unchanged = result.ToJsonString();
        await narration.Complete(result);
        Assert.Equal(new[] { (prefix + suffix).Trim(), rest }, audio);
        Assert.Equal(unchanged, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "You can review your current registration details and your course information, ", "including your current schedule in the student portal before choosing a university service.")]
    [InlineData("ar", "تقدر تراجع تفاصيل تسجيلك الحالي ومعلومات مقرراتك من خلال حسابك الجامعي، ", "وتشوف جدولك الدراسي قبل اختيار الخدمة المطلوبة.")]
    public async Task Long_opening_keeps_fast_clause_playback_and_every_remaining_word(string language, string clause, string rest)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("registration", language,
            new VoiceSentences(language, s => { audio.Add(s); return Task.CompletedTask; }, 160));
        await narration.Push(clause);
        Assert.Single(audio);
        await narration.Push(rest);
        await narration.Complete(Result(clause + rest));
        Assert.Equal((clause + rest).TrimEnd('.'), string.Join(" ", audio.Select(s => s.TrimEnd('.'))));
    }

    [Theory]
    [InlineData("en", "You're welcome! Happy to help. Goodbye!")]
    [InlineData("ar", "العفو، حياك الله! يسعدني أساعدك. مع السلامة.")]
    [InlineData("ar", "وعليكم السلام ورحمة الله وبركاته. الحمد لله بخير. اسمي ميرا. كيف أقدر أساعدك؟")]
    [InlineData("en", "Hello! I'm well. My name is Suhail. How can I help you today?")]
    public async Task Greetings_and_farewells_keep_their_complete_existing_words(string language, string answer)
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("hello", language,
            new VoiceSentences(language, s => { audio.Add(s); return Task.CompletedTask; }));
        foreach (var character in answer) await narration.Push(character.ToString());
        await narration.Complete(Result(answer, "greeting"));
        Assert.Equal(VoiceSpeechFormatter.ToSpeech(answer, language), string.Join(" ", audio));
    }

    [Fact]
    public async Task Trimming_the_model_result_does_not_repeat_the_spoken_greeting()
    {
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("Hello", "en",
            new VoiceSentences("en", s => { audio.Add(s); return Task.CompletedTask; }));
        await narration.Push("  Hello! ");
        await narration.Push("How can I help?\n");
        await narration.Complete(Result("Hello! How can I help?", "greeting"));
        Assert.Equal(new[] { "Hello!", "How can I help?" }, audio);
    }

    [Fact]
    public async Task Service_summary_keeps_exact_answer_key_facts_deadline_fee_and_next_step()
    {
        const string answer = "You are eligible to request an enrolment letter. " +
            "The portal has a blue navigation menu. The menu offers several other services. " +
            "Each service has its own page. Background information is available on the home page. " +
            "The fee is AED 50. You must apply before 25 October 2026. " +
            "Download the letter from My Documents after approval.";
        var result = Result(answer);
        var original = result.ToJsonString();
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("Am I eligible and how do I request a letter?", "en",
            new VoiceSentences("en", s => { audio.Add(s); return Task.CompletedTask; }));
        await narration.Complete(result); // No streamed/unconfirmed transaction text.
        var spoken = string.Join(" ", audio);
        Assert.Contains("You are eligible to request an enrolment letter.", spoken);
        Assert.Contains("AED 50", spoken);
        Assert.Contains("before 25 October 2026", spoken);
        Assert.Contains("Download the letter from My Documents after approval.", spoken);
        Assert.DoesNotContain("blue navigation", spoken);
        Assert.True(spoken.Length < answer.Length);
        Assert.Equal(original, result.ToJsonString());
    }

    [Fact]
    public async Task Arabic_summary_keeps_conditions_numbers_and_next_step_in_Arabic()
    {
        const string answer = "تقدر تطلب خطاب القيد من البوابة. " +
            "تحتوي الصفحة على قائمة جانبية. يمكن تغيير حجم القائمة. تظهر الأيقونات أعلى الصفحة. " +
            "تعرض الصفحة معلومات عامة. الرسوم 50 درهماً. يجب تقديم الطلب قبل 25 أكتوبر 2026. " +
            "نزّل الخطاب من وثائقي بعد الموافقة.";
        var parts = VoiceReplyNarration.Select(answer, "كيف أطلب خطاب القيد؟", "ar");
        var spoken = string.Concat(parts.Select(p => answer[p.Start..p.End]));
        Assert.Contains("الرسوم 50 درهماً", spoken);
        Assert.Contains("قبل 25 أكتوبر 2026", spoken);
        Assert.Contains("بعد الموافقة", spoken);
        Assert.DoesNotContain("حجم القائمة", spoken);
        var audio = new List<string>();
        var narration = new VoiceReplyNarration("كيف أطلب خطاب القيد؟", "ar",
            new VoiceSentences("ar", s => { audio.Add(s); return Task.CompletedTask; }));
        await narration.Push(answer);
        await narration.Complete(Result(answer));
        Assert.Equal(VoiceSpeechFormatter.ToSpeech(spoken, "ar"), string.Join(" ", audio));
    }

    [Fact]
    public void Approval_preview_is_complete_but_a_receipt_does_not_bypass_the_summary()
    {
        const string answer = "Subject: Bus service. Body: The bus was late. This happened on Sunday. " +
            "The location was the main campus. The route was route five. Please approve submission.";
        var result = Result(answer);
        result["proposedActions"] = new JsonArray(new JsonObject { ["toolName"] = "create_complaint" });
        Assert.True(VoiceReplyNarration.PreserveFullReply(result));
        Assert.Equal(answer, string.Concat(VoiceReplyNarration.Select(answer, "complaint", "en", true)
            .Select(p => answer[p.Start..p.End])));
        result["proposedActions"] = new JsonArray();
        result["receipt"] = new JsonObject { ["reference"] = "REQ-123" };
        Assert.False(VoiceReplyNarration.PreserveFullReply(result));
    }

    [Fact]
    public void Limitations_and_the_statement_they_qualify_are_retained()
    {
        const string answer = "Here is the scholarship information. The portal has menus. " +
            "An information page explains the background. Many students use the portal. " +
            "You meet the GPA requirement. However, you are not eligible until the residency check is complete. " +
            "Contact Student Services for verification.";
        var parts = VoiceReplyNarration.Select(answer, "Am I eligible?", "en");
        var spoken = string.Concat(parts.Select(p => answer[p.Start..p.End]));
        Assert.Contains("You meet the GPA requirement.", spoken);
        Assert.Contains("not eligible until the residency check is complete", spoken);
        Assert.Contains("Contact Student Services", spoken);
    }

    [Fact]
    public async Task Cancellation_during_summary_does_not_continue_synthesis()
    {
        var calls = 0;
        var narration = new VoiceReplyNarration("question", "en", new VoiceSentences("en", _ =>
        { calls++; throw new OperationCanceledException(); }));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => narration.Complete(Result("First. Second. Third.")));
        Assert.Equal(1, calls);
    }

    [Theory]
    [InlineData("en", "How do I request my letter?", "You can request your letter through the portal. You must sign in. " +
        "You must open Services. You must select Letters. You must check the language. " +
        "You must confirm your address. You must review your contact details. You must submit the request.")]
    [InlineData("ar", "كيف أطلب الخطاب؟", "تقدر تطلب الخطاب من البوابة. يجب تسجيل الدخول. " +
        "يجب فتح الخدمات. يجب اختيار الخطابات. يجب مراجعة اللغة. " +
        "يجب تأكيد العنوان. يجب مراجعة بيانات التواصل. يجب تقديم الطلب.")]
    public async Task Procedural_keywords_cannot_make_the_voice_read_every_line(string language, string question, string answer)
    {
        var selected = VoiceReplyNarration.Select(answer, question, language);
        Assert.InRange(selected.Count, 2, 4);
        var audio = new List<string>();
        var narration = new VoiceReplyNarration(question, language,
            new VoiceSentences(language, s => { audio.Add(s); return Task.CompletedTask; }, naturalPhrasing: true));
        var result = Result(answer);
        var original = result.ToJsonString();
        await narration.Push(answer);
        await narration.Complete(result);
        var spoken = string.Join(" ", audio);
        Assert.True(spoken.Length < answer.Length * 0.8);
        Assert.Equal(original, result.ToJsonString()); // Full answer/cards remain available on screen.
    }

    [Fact]
    public void Summary_prioritizes_the_asked_fact_over_other_optional_topics()
    {
        const string answer = "Here is your academic overview. Your address is available in your profile. " +
            "Your library card is active. You have campus transport access. Your GPA is 3.75. " +
            "Your course schedule has 5 courses. Your enrolment is current.";
        var selected = VoiceReplyNarration.Select(answer, "What is my GPA?", "en");
        Assert.Contains(selected, part => part.Text.Contains("Your GPA is 3.75"));
        Assert.InRange(selected.Count, 1, 4);
    }

    [Theory]
    [InlineData("en", "What is my id?", "Here is your profile information.", "ID", "Status", "Active",
        "These details belong to your signed-in account.")]
    [InlineData("ar", "ما هو رقم الطالب؟", "هذه معلومات حسابك في الجامعة.", "رقم الطالب", "الحالة", "فعال",
        "تخص هذه البيانات حسابك الذي سجلت الدخول إليه.")]
    public void Highlights_keep_the_requested_identifier_instead_of_only_reading_surrounding_text(
        string language, string question, string opening, string idLabel, string otherLabel, string otherValue, string closing)
    {
        var result = Result($"{opening}\n- **{idLabel}:** 009876543\n- **{otherLabel}:** {otherValue}\n\n{closing}");
        var original = result.ToJsonString();
        var spoken = VoiceReplyNarration.Overview(result, question, language);
        Assert.Contains("009876543", spoken);
        Assert.DoesNotContain(otherLabel, spoken);
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "You meet the GPA requirement. However, you are not eligible until residency is verified.")]
    [InlineData("ar", "أنت تستوفي شرط المعدل. لكن لا يمكن الموافقة حتى يتم التحقق من الإقامة.")]
    public void The_opening_eligibility_statement_never_loses_its_caveat(string language, string opening)
    {
        var answer = opening + (language == "en"
            ? " Your fee is AED 50. The deadline is 25 October. Contact Student Services. You must check the portal."
            : " الرسوم 50 درهماً. الموعد النهائي 25 أكتوبر. تواصل مع خدمات الطلبة. يجب مراجعة البوابة.");
        var selected = VoiceReplyNarration.Select(answer, "GPA المعدل", language);
        Assert.Equal(0, selected[0].Start);
        Assert.Equal(2, selected.Count(part => part.Start < opening.Length));
        Assert.InRange(selected.Count, 2, 4);
    }

    private static JsonObject IssuedLetter(string language)
    {
        const string reference = "UAEU-TWIMC-2026-000088";
        var answer = language == "ar"
            ? $"تم إنشاء إفادة التسجيل الخاصة بك فوراً.\n\n**تفاصيل المستند**\n- **الرقم المرجعي:** {reference}\n- **نوع المستند:** شهادة لمن يهمه الأمر (إفادة قيد)\n- **اللغة:** العربية\n- **حالة القيد:** فعّال\n\nوفقاً لإرشادات الجامعة، تُصدر إفادات التسجيل الرسمية تلقائياً من سجلك المعتمد في برنامج بكالوريوس علوم الحاسوب في كلية تقنية المعلومات.\n\nمستندك جاهز هنا في المحادثة مع خيارَي **التنزيل** و**المشاركة**، وسيبقى متاحاً أيضاً في «وثائقي» للرجوع إليه لاحقاً."
            : $"Your enrolment letter has been generated instantly.\n\n**Document details**\n- **Reference number:** {reference}\n- **Document type:** To Whom It May Concern (Enrolment Certificate)\n- **Language:** English\n- **Enrolment status:** Active\n\nUnder university guidelines, official enrolment letters are issued automatically from your verified record in BSc Computer Science at College of Information Technology.\n\nYour document is ready right here in the chat with options to **Download** and **Share**. It will also remain accessible under \"My Documents\" for future reference.";
        var result = Result(answer, "check_enrollment_letter_readiness", "issue_enrollment_letter");
        result["responseType"] = "receipt";
        result["verified"] = true;
        result["issuedDocument"] = new JsonObject
        {
            ["documentId"] = "document-id", ["status"] = "valid", ["language"] = language,
            ["referenceNumber"] = reference, ["fileName"] = reference + ".pdf",
            ["verifyUrl"] = "/verify/test-only", ["verifyToken"] = "test-only"
        };
        result["receipt"] = new JsonObject
        {
            ["actionType"] = "issue_enrollment_letter", ["referenceNumber"] = reference,
            ["nextStep"] = language == "ar" ? "الخطاب جاهز للتنزيل من وثائقي." : "Your letter is ready to download from My Documents."
        };
        return result;
    }

    [Theory]
    [InlineData("en", "Your enrolment letter has been generated instantly", "Download", "Reference number", "Document type")]
    [InlineData("ar", "تم إنشاء إفادة التسجيل الخاصة بك فوراً", "التنزيل", "الرقم المرجعي", "نوع المستند")]
    public void Final_spoken_highlights_prioritize_the_outcome_and_next_step_over_card_labels(
        string language, string outcome, string nextStep, string referenceLabel, string typeLabel)
    {
        var result = IssuedLetter(language);
        var original = result.ToJsonString();
        var overview = VoiceReplyNarration.Overview(result, "", language);
        Assert.Contains(outcome, overview);
        Assert.Contains(nextStep, overview);
        Assert.DoesNotContain(referenceLabel, overview);
        Assert.DoesNotContain(typeLabel, overview);
        Assert.True(overview.Length < result["answer"]!.GetValue<string>().Length);
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "The requested document is ready for you to download from your student account now.",
        "The supporting information comes directly from the verified student record used for this request.",
        "You can download the document here and keep a copy for your own records.")]
    [InlineData("ar", "المستند المطلوب جاهز الآن ويمكنك تنزيله من حسابك الشخصي لدى الجامعة للاحتفاظ بنسخة منه.",
        "تأتي المعلومات المعروضة مباشرة من السجل المعتمد للطالب والذي تم استخدامه لهذا الطلب.",
        "يمكنك تنزيل المستند هنا والاحتفاظ بنسخة منه في ملفاتك الخاصة للرجوع إليها عند الحاجة.")]
    public void Three_sentence_answers_are_spoken_as_highlights_not_the_full_answer(
        string language, string opening, string detail, string next)
    {
        var answer = $"{opening} {detail} {next}";
        var result = Result(answer);
        var original = result.ToJsonString();
        var spoken = VoiceReplyNarration.Overview(result, "", language);
        Assert.Contains(opening, spoken);
        Assert.Contains(next, spoken);
        Assert.DoesNotContain(detail, spoken);
        Assert.True(spoken.Length < answer.Length);
        Assert.InRange(System.Text.RegularExpressions.Regex.Matches(spoken, @"\S+").Count, 1, 45);
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "The source confirms this available service", "Download the document from your account.")]
    [InlineData("ar", "يؤكد المصدر أن هذه الخدمة متاحة للطالب", "يمكنك تنزيل المستند من حسابك الشخصي.")]
    public void Long_explanations_have_a_short_shared_spoken_budget(string language, string detail, string next)
    {
        var opening = language == "ar" ? "المستند جاهز." : "The document is ready.";
        var paragraph = string.Join(" ", Enumerable.Repeat(detail, 4)) + ".";
        var result = Result($"{opening} {paragraph} {paragraph} {next}");
        var original = result.ToJsonString();
        var spoken = VoiceReplyNarration.Overview(result, "", language);
        Assert.Contains(opening, spoken);
        Assert.Contains(next, spoken);
        Assert.InRange(System.Text.RegularExpressions.Regex.Matches(spoken, @"\S+").Count, 1, 45);
        Assert.Equal(original, result.ToJsonString());
    }

    [Theory]
    [InlineData("en", "What is the reference number for my letter?")]
    [InlineData("ar", "ما هو الرقم المرجعي لإفادة التسجيل؟")]
    public void Final_spoken_overview_keeps_a_card_value_when_it_is_the_requested_detail(string language, string question)
    {
        var result = IssuedLetter(language);
        Assert.Contains("UAEU-TWIMC-2026-000088", VoiceReplyNarration.Overview(result, question, language));
    }

    [Theory]
    [InlineData("en", "Please issue my enrolment letter.", "Your enrolment letter is ready. You can download or share it here, and find it later in My Documents.")]
    [InlineData("ar", "أريد إفادة تسجيل.", "إفادة التسجيل جاهزة. تقدر تنزّلها أو تشاركها من هنا، وبتحصلها أيضاً في «وثائقي».")]
    public async Task Document_card_is_spoken_as_an_outcome_and_delivery_briefing_only(string language, string question, string expected)
    {
        var result = IssuedLetter(language);
        var original = result.ToJsonString();
        var spoken = new List<string>();
        var narration = new VoiceReplyNarration(question, language,
            new VoiceSentences(language, text => { spoken.Add(text); return Task.CompletedTask; }, naturalPhrasing: true));
        Assert.Empty(spoken);
        await narration.Complete(result);
        Assert.Equal(expected, string.Join(" ", spoken));
        Assert.DoesNotContain("UAEU-TWIMC", string.Join(" ", spoken));
        Assert.True(expected.Length < result["answer"]!.GetValue<string>().Length / 3);
        Assert.Equal(original, result.ToJsonString()); // Card, PDF links, history and full text are intact.
    }

    [Theory]
    [InlineData("en", "What is the reference number for my letter?")]
    [InlineData("ar", "ما هو الرقم المرجعي لإفادة التسجيل؟")]
    public async Task A_specific_document_detail_is_still_answered_when_requested(string language, string question)
    {
        var result = IssuedLetter(language);
        var spoken = new List<string>();
        await new VoiceReplyNarration(question, language,
            new VoiceSentences(language, text => { spoken.Add(text); return Task.CompletedTask; }, naturalPhrasing: true)).Complete(result);
        Assert.Contains("UAEU-TWIMC-2026-000088", string.Join(" ", spoken));
        Assert.True(string.Join(" ", spoken).Length < result["answer"]!.GetValue<string>().Length);
    }

    [Theory]
    [InlineData("en", "unverified")]
    [InlineData("ar", "unverified")]
    [InlineData("en", "no_document")]
    [InlineData("ar", "no_document")]
    [InlineData("en", "revoked")]
    [InlineData("ar", "revoked")]
    [InlineData("en", "error")]
    [InlineData("ar", "error")]
    [InlineData("en", "no_receipt")]
    [InlineData("ar", "no_receipt")]
    public async Task A_failed_or_unconfirmed_document_never_gets_a_success_briefing(string language, string condition)
    {
        var result = IssuedLetter(language);
        var failure = language == "ar" ? "تعذر إصدار الخطاب. يرجى التواصل مع خدمات الطلبة." : "The letter could not be issued. Please contact Student Services.";
        result["answer"] = failure;
        switch (condition)
        {
            case "unverified": result["verified"] = false; break;
            case "no_document": result["issuedDocument"] = null; break;
            case "revoked": result["issuedDocument"]!["status"] = "revoked"; break;
            case "error": result["responseType"] = "error"; break;
            case "no_receipt": result["receipt"] = null; break;
        }
        var spoken = new List<string>();
        await new VoiceReplyNarration("letter", language,
            new VoiceSentences(language, text => { spoken.Add(text); return Task.CompletedTask; }, naturalPhrasing: true)).Complete(result);
        Assert.Equal(failure, string.Join(" ", spoken));
    }

    [Theory]
    [InlineData("en", "Your request was submitted. Reference number: REQ-123. Your case is assigned to Student Services. " +
        "The portal has several menus. The help page has more information. Your response is due before 25 October. " +
        "Contact Student Services if your situation changes.")]
    [InlineData("ar", "تم تقديم طلبك. الرقم المرجعي: REQ-123. تم إسناد طلبك لخدمات الطلبة. " +
        "تحتوي البوابة على قوائم عديدة. توجد معلومات في صفحة المساعدة. الموعد النهائي للرد قبل 25 أكتوبر. " +
        "تواصل مع خدمات الطلبة إذا تغيرت ظروفك.")]
    public async Task Other_receipts_use_the_existing_bounded_summary_instead_of_reading_every_line(string language, string answer)
    {
        var result = Result(answer);
        result["receipt"] = new JsonObject { ["actionType"] = "create_complaint", ["referenceNumber"] = "REQ-123" };
        result["responseType"] = "receipt";
        var original = result.ToJsonString();
        var spoken = new List<string>();
        await new VoiceReplyNarration("request طلب", language,
            new VoiceSentences(language, text => { spoken.Add(text); return Task.CompletedTask; }, naturalPhrasing: true)).Complete(result);
        Assert.True(string.Join(" ", spoken).Length < answer.Length);
        Assert.Contains("REQ-123", string.Join(" ", spoken));
        Assert.Equal(original, result.ToJsonString());
    }

    [Fact]
    public async Task A_pending_approval_is_not_replaced_with_a_document_success_briefing()
    {
        var result = IssuedLetter("en");
        const string approval = "Subject: Letter request. Body: A letter for my employer. Please approve before submission.";
        result["answer"] = approval;
        result["proposedActions"] = new JsonArray(new JsonObject { ["toolName"] = "submit_request" });
        var spoken = new List<string>();
        await new VoiceReplyNarration("letter", "en",
            new VoiceSentences("en", text => { spoken.Add(text); return Task.CompletedTask; }, naturalPhrasing: true)).Complete(result);
        Assert.Equal(approval, string.Join(" ", spoken));
    }

    [Fact]
    public async Task Interrupting_a_document_briefing_stops_its_remaining_audio()
    {
        var calls = 0;
        var narration = new VoiceReplyNarration("letter", "en", new VoiceSentences("en", _ =>
        { calls++; throw new OperationCanceledException(); }, naturalPhrasing: true));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => narration.Complete(IssuedLetter("en")));
        Assert.Equal(1, calls);
    }
}

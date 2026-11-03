using Sanadi.Api.AI;
using Sanadi.Api.Controllers;

namespace Sanadi.Api.Tests;

public sealed class ProactiveAndGreetingTests
{
    [Theory]
    [InlineData("Do I need to apply for a campus entry permit?", "en")]
    [InlineData("هل أحتاج أقدم طلب تصريح دخول للحرم؟", "ar")]
    [InlineData("كيف أطلب تصريح دخول للجامعة؟", "ar")]
    public void Campus_entry_is_answered_without_a_request(string text, string lang)
    {
        var reply = ProactiveServiceFlow.Resolve(text, lang);
        Assert.NotNull(reply);
        Assert.Equal("campus_entry_proactive", reply.Category);
        Assert.Equal("SVC-CAMPUS-ENTRY", reply.ServiceCode);
        Assert.Contains(lang == "ar" ? "خبر سار" : "Good news", reply.Answer);
        Assert.Contains(lang == "ar" ? "طلب منفصل" : "separate request", reply.Answer);
        Assert.DoesNotContain("Submit", reply.Answer);
    }

    [Theory]
    [InlineData("What time does the library close?")]
    [InlineData("I can see smoke coming from one of the classrooms.")]
    [InlineData("The buses are always late")]
    public void Unrelated_questions_are_not_campus_entry(string text) =>
        Assert.Null(ProactiveServiceFlow.Resolve(text, "en"));

    [Fact]
    public void Hidden_client_instructions_are_not_part_of_the_question()
    {
        var guided = """
            Do I need to apply for a campus entry permit?

            Answer the user's exact question directly in the same language they used. Be concise, cover each part asked, and avoid unrelated background. Ask no more than one short, focused follow-up at a time, and only for details needed to answer or prepare a requested enquiry, complaint, suggestion, or alert.
            """;
        var student = ConversationalTurn.StudentText(guided);
        Assert.Equal("Do I need to apply for a campus entry permit?", student);
        Assert.False(ComplaintChatFlow.IsComplaintIntent(student));
        Assert.True(ComplaintChatFlow.IsComplaintIntent(guided));
        Assert.Equal("campus_entry_proactive", ProactiveServiceFlow.Resolve(student, "en")?.Category);
    }

    [Fact]
    public void Registered_subjects_are_listed_and_a_chosen_subject_is_an_inquiry()
    {
        Assert.True(CurrentCoursesFlow.IsQuestion("Can I see the subjects I am registered to this semester?"));
        Assert.False(CurrentCoursesFlow.IsQuestion("Where can I find the textbook for CSBP301?"));
        var courses = new CurrentCoursesFlow.Course[]
        {
            new("CSBP219", "Object Oriented Programming", "البرمجة كائنية التوجه", 3),
            new("MATH110", "Calculus II", "حساب التفاضل والتكامل 2", 3)
        };
        var answer = CurrentCoursesFlow.Answer(courses, "en");
        Assert.Contains("**Current courses**", answer);
        Assert.Contains("1. CSBP219 — Object Oriented Programming · 3 cr", answer);
        Assert.Contains("Total: 2 course(s), 6 credit hours this semester.", answer);
        Assert.Contains("[View full academic record](/academic#current)", answer);
        Assert.Equal("CSBP219", CurrentCoursesFlow.ChosenCode("CSBP219"));
        Assert.Equal("ENGL310", CurrentCoursesFlow.ChosenCode("engl 310"));
        Assert.Null(CurrentCoursesFlow.ChosenCode("Can I see the subjects I am registered to this semester?"));
        var inquiry = CurrentCoursesFlow.Inquiry(courses[0], "Student Complaints Office", "COMP", "en");
        Assert.Contains("Student Complaints Office", inquiry);
        Assert.Contains("TITLE: Inquiry about CSBP219 Course Details", inquiry);
        Assert.Contains("TYPE: Query", inquiry);
        Assert.Contains("PROCESSING TIME: Up to 5 working days", inquiry);
        Assert.Contains("Would you like me to proceed with submitting this request?", inquiry);
        Assert.Contains("one secondary detail", inquiry);
    }

    [Fact]
    public void A_gate_that_will_not_open_is_a_problem_not_a_new_permit()
    {
        var reply = ProactiveServiceFlow.Resolve("My UAEU ID is not opening the gate", "en");
        Assert.Equal("campus_entry_problem", reply?.Category);
        Assert.Contains("Security Office", reply!.Answer);
    }

    [Theory]
    [InlineData("Hi", "en", "academic questions")]
    [InlineData("مرحباً", "ar", "الأسئلة الدراسية")]
    public void Short_greetings_use_the_fixed_introduction(string text, string lang, string expected) =>
        Assert.Contains(expected, ConversationalTurn.GreetingReply(text, lang));

    [Theory]
    [InlineData("Can you create my enrolment letter?")]
    [InlineData("ممكن تطلع لي إفادة تسجيل؟")]
    [InlineData("I need an enrolment letter")]
    public void Enrolment_letter_requests_are_recognized(string text) =>
        Assert.True(AssistantController.IsLetterRequest(text));

    [Fact]
    public void Smoke_and_a_lost_wallet_use_the_contact_register()
    {
        var fire = new CampusIncidentRouting.Contact
        {
            Code = "fire", CategoryEn = "General Emergency", TypeEn = "Fire / Fire alarm",
            UnitEn = "Operations and Emergency Section", EmergencyNumber = "6888", Email = "OES@example.test",
            Keywords = """["smoke","fire","دخان","حريق"]"""
        };
        var lost = new CampusIncidentRouting.Contact
        {
            Code = "security", CategoryEn = "Security", TypeEn = "Security incidents / Lost property",
            UnitEn = "FMD", EmergencyNumber = "4488", Email = "LostNFound@example.test",
            Keywords = """["lost","wallet","ضاع","محفظة"]"""
        };
        Assert.Equal("fire", CampusIncidentRouting.Match("I can see smoke coming from one of the classrooms.", [fire, lost])?.Code);
        Assert.Equal("fire", CampusIncidentRouting.Match("أشوف دخان يطلع من إحدى القاعات الدراسية.", [fire, lost])?.Code);
        Assert.Equal("security", CampusIncidentRouting.Match("I lost my wallet somewhere on campus.", [fire, lost])?.Code);
        Assert.Equal("security", CampusIncidentRouting.Match("ضاع مني المحفظة في الحرم الجامعي.", [fire, lost])?.Code);
        Assert.Contains("call 999 immediately", CampusIncidentRouting.Answer(fire, "en"));
        Assert.Contains("999", CampusIncidentRouting.Answer(fire, "ar"));
    }
}

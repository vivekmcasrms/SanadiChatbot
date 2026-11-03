using System.Text.Json.Nodes;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class CareerChatFlowTests
{
    [Theory]
    [InlineData("What kind of jobs would suit my degree and skills?", "matches")]
    [InlineData("What is my ATS score?", "ats")]
    [InlineData("ما هي درجة سيرتي الذاتية في أنظمة الفرز؟", "ats")]
    [InlineData("Review my CV", "cv_review")]
    [InlineData("What skills should I learn next?", "skill_gap")]
    [InlineData("What skills am I missing for those jobs?", "skill_gap")]
    [InlineData("ما الوظائف المناسبة لتخصصي ومهاراتي؟", "matches")]
    [InlineData("وما المهارات اللي ناقصتني عشان أكون مناسب لهذه الوظائف؟", "skill_gap")]
    [InlineData("Am I ready to apply?", "readiness")]
    [InlineData("Book a career counsellor", null)]
    [InlineData("What is machine learning?", null)]
    [InlineData("What is a job?", null)]
    [InlineData("Where is my textbook for HIST120?", null)]
    public void Routes_career_analysis_and_upload_followup_only(string question,string? topic) => Assert.Equal(topic,CareerChatFlow.Topic(question));

    private static JsonObject Analysis() => JsonNode.Parse("""
        {"hasCv":false,"cvAnalyzed":false,"evidence":{"hasProfile":true},"versionNo":4,"calculatedAt":"2026-09-29T00:00:00Z",
         "matches":[{"roleCode":"configured-role","titleEn":"Configured analyst","titleAr":"محلل","fitScore":67,"jobReadinessScore":23,"evidenceItems":[{"textEn":"Verified programme","textAr":"البرنامج الموثق"}]}],
         "skillGaps":{"targetRoleEn":"Configured analyst","targetRoleAr":"محلل","strong":[],"developing":[],"missing":[{"skill":"SQL"}]},
         "actionPlan":[{"titleEn":"Practice SQL","titleAr":"تدرب على SQL"}]}
        """)!.AsObject();

    [Fact]
    public void Answer_and_card_preserve_engine_scores_gaps_and_existing_case()
    {
        var a=Analysis(); var before=a.ToJsonString();
        var result=CareerChatFlow.Build(a,JsonNode.Parse("""{"reference":"CASE-TEST","status":"assigned"}"""),"matches","en");
        Assert.Contains("fit 67%, readiness 23%",result.Answer);
        Assert.Equal(67,(int)result.Card["matches"]![0]!["fitScore"]!);
        Assert.Equal("SQL",(string?)result.Card["skillGaps"]!["missing"]![0]);
        Assert.Equal("CASE-TEST",(string?)result.Card["counsellingRequest"]!["reference"]);
        Assert.Contains("Upload CV",result.NextSteps.ToJsonString());
        Assert.Single(result.NextSteps);
        Assert.Equal(before,a.ToJsonString());
    }

    [Fact]
    public void Unreadable_cv_requests_replacement_instead_of_claiming_no_cv()
    {
        var a=Analysis(); a["hasCv"]=true;
        var result=CareerChatFlow.Build(a,null,"ats","en");
        Assert.Contains("could not be analysed",result.Answer);
        Assert.DoesNotContain("do not have a CV",result.Answer);
        Assert.Contains("Replace CV",result.NextSteps.ToJsonString());
        Assert.Null(result.Card["ats"]);
    }

    [Fact]
    public void Arabic_role_titles_and_evidence_are_preserved()
    {
        var result=CareerChatFlow.Build(Analysis(),null,"matches","ar");
        Assert.Contains("محلل",result.Answer); Assert.Contains("البرنامج الموثق",result.Answer);
        Assert.Equal("محلل",(string?)result.Card["matches"]![0]!["title"]);
    }

    [Fact]
    public void Skills_followup_includes_missing_list_action_plan_and_snapshot()
    {
        var result=CareerChatFlow.Build(Analysis(),JsonNode.Parse("""{"reference":"CASE-TEST","status":"assigned"}"""),
            CareerChatFlow.Topic("What skills am I missing for those jobs?")!,"en");
        Assert.Contains("Compared with what **Configured analyst** requires:",result.Answer);
        Assert.Contains("**Missing**\n- SQL",result.Answer);
        Assert.Contains("**Next steps**\n- Practice SQL",result.Answer);
        Assert.Contains("university record only",result.Answer);
        Assert.Equal("skill_gap",(string?)result.Card["topic"]);
        Assert.Single(result.Card["matches"]!.AsArray());
        Assert.Equal("SQL",(string?)result.Card["skillGaps"]!["missing"]![0]);
        Assert.Equal("CASE-TEST",(string?)result.Card["counsellingRequest"]!["reference"]);
        Assert.False((bool)result.Card["cv"]!["hasCv"]!);
    }

    [Fact]
    public void Absent_student_evidence_does_not_present_generic_scores_as_personal_matches()
    {
        var a=Analysis(); a["evidence"]!["hasProfile"]=false;
        var result=CareerChatFlow.Build(a,null,"matches","en");
        Assert.Empty(result.Card["matches"]!.AsArray());
        Assert.Contains("could not find a linked academic record",result.Answer,StringComparison.OrdinalIgnoreCase);
    }
}

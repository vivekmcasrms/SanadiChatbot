using System.Text.Json;
using Sanadi.Api.AI;

namespace Sanadi.Api.Tests;

public sealed class ChatConcernPlannerTests
{
    private static readonly InteractionUnitRouting.Unit Unit=new(Guid.NewGuid(),"configured","Configured team","الجهة","Configured remit",null);
    private static string Plan(bool clarify=false,double confidence=.95,double routing=.95,string type="query",Guid? id=null,string title="Application dates")=>
        JsonSerializer.Serialize(new {needsClarification=clarify,question=clarify?"Which programme do you mean?":"",type,title,searchQuery="When can I apply for exchange?",unitId=id,confidence,routingConfidence=routing,usePrevious=true});
    [Fact] public void Ready_intent_is_not_permission_to_guess_a_recipient()
    {
        Assert.False(ChatConcernPlanner.Parse(Plan(),[Unit],"en").CanRoute);
        Assert.False(ChatConcernPlanner.Parse(Plan(id:Unit.Id,routing:.3),[Unit],"en").CanRoute);
        Assert.False(ChatConcernPlanner.Parse(Plan(id:Unit.Id,confidence:.3),[Unit],"en").CanRoute);
        Assert.True(ChatConcernPlanner.Parse(Plan(id:Unit.Id),[Unit],"en").CanRoute);
    }
    [Theory]
    [InlineData("query")]
    [InlineData("complaint")]
    [InlineData("alert")]
    [InlineData("suggestion")]
    public void All_concern_types_have_the_same_routing_and_uncertainty_rules_in_both_languages(string type)
    {
        var raw=Plan(type:type,id:Unit.Id);
        var en=ChatConcernPlanner.Parse(raw,[Unit],"en");
        var ar=ChatConcernPlanner.Parse(raw,[Unit],"ar");
        Assert.Equal(en,ar);
        Assert.Equal(type,en.Type);
        Assert.True(en.CanRoute);
        foreach(var language in new[]{"en","ar"})
        {
            Assert.False(ChatConcernPlanner.Parse(Plan(type:type),[Unit],language).CanRoute);
            Assert.False(ChatConcernPlanner.Parse(Plan(type:type,id:Unit.Id,routing:.2),[Unit],language).CanRoute);
            Assert.False(ChatConcernPlanner.Parse(Plan(type:type,id:Unit.Id,confidence:.2),[Unit],language).CanRoute);
        }
    }
    [Fact] public void Unknown_type_or_missing_title_or_invalid_confidence_is_rejected()
    {
        Assert.Throws<JsonException>(()=>ChatConcernPlanner.Parse(Plan(type:"execute"),[Unit],"en"));
        Assert.Throws<JsonException>(()=>ChatConcernPlanner.Parse(Plan(title:""),[Unit],"en"));
        Assert.Throws<JsonException>(()=>ChatConcernPlanner.Parse(Plan(routing:2),[Unit],"en"));
    }
    [Theory]
    [InlineData("query")]
    [InlineData("complaint")]
    [InlineData("alert")]
    [InlineData("suggestion")]
    public void Untrusted_recipient_cannot_create_a_route_or_erase_a_valid_intent(string type)
    {
        foreach(var lang in new[]{"en","ar"})
        foreach(var invalidId in new[]{"null","invented-team",Guid.NewGuid().ToString()})
        {
            var json=System.Text.Json.Nodes.JsonNode.Parse(Plan(type:type))!;
            json["unitId"]=invalidId;
            var result=ChatConcernPlanner.Parse(json.ToJsonString(),[Unit],lang);
            Assert.Null(result.Unit);
            Assert.False(result.CanRoute);
            Assert.Equal(type,result.Type);
            Assert.False(result.NeedsClarification); // The request is clear; only its recipient is unknown.
        }
    }
    [Fact] public void Follow_up_question_survives_and_uncertainty_cannot_offer_submission()
    {
        var plan=ChatConcernPlanner.Parse(Plan(clarify:true,id:Unit.Id),[Unit],"en");
        Assert.True(plan.NeedsClarification);Assert.True(plan.UsePrevious);Assert.False(plan.CanRoute);
        Assert.Equal("Which programme do you mean?",plan.Question);
    }
    [Theory]
    [InlineData("I have a problem",true)]
    [InlineData("When can I apply?",true)]
    [InlineData("Find me a book",true)]
    [InlineData("It isn't working",true)]
    [InlineData("Where can I find books on control systems?",false)]
    [InlineData("What jobs suit my degree?",false)]
    public void Vague_guard_keeps_specific_specialist_requests_intact(string text,bool vague)=>Assert.Equal(vague,ChatConcernPlanner.IsVague(text));
}

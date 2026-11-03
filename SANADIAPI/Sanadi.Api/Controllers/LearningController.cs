using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController,Route("api/learning")]
public sealed class LearningController(ISqlConnectionFactory sql):ControllerBase
{
    private static readonly string[] Readers=["system_admin","service_manager","knowledge_manager","auditor","service_owner"];
    private static readonly string[] Reviewers=["system_admin","service_manager","knowledge_manager"];
    private Guid User(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private async Task<(Guid id,string[] roles)>Require(string[] allowed){var id=User();await using var db=sql.Create();var roles=(await db.QueryAsync<string>(DbProc.Call("usp_Learning_GetUserRoles",new{id},CancellationToken.None))).ToArray();if(!roles.Any(allowed.Contains))throw new ForbiddenException();return(id,roles);}
    public sealed record CandidateDecision(Guid CandidateId,string Decision,string? Note,JsonElement? Edits);
    public sealed record Toggle(Guid RuleId,bool Active);
    public sealed record Feedback(Guid? ConversationId,Guid? MessageId,bool Helpful,string? ReasonCode,string? Comment,string? Domain,string? UserText);
    public sealed record RuleDecision(Guid RuleId,string Action,string? Reason,JsonElement? Edits);
    public sealed record Config(int? ThresholdLow,int? ThresholdNormal,int? ThresholdHigh,double? MinHistoricalAccuracy,int? MinShadowSamples,double? MinShadowAccuracy,bool? AutoActivationEnabled,double? PauseConfidence);

    [HttpGet("center")]
    public async Task<object>Center(){var(_,roles)=await Require(Readers);await using var db=sql.Create();var signals=await db.QueryAsync(DbProc.Call("usp_Learning_ListSignals",null,CancellationToken.None));var candidates=(await db.QueryAsync(DbProc.Call("usp_Learning_ListCandidates",null,CancellationToken.None))).ToArray();var rules=(await db.QueryAsync(DbProc.Call("usp_Learning_ListRoutingRules",null,CancellationToken.None))).ToArray();var units=await db.QueryAsync(DbProc.Call("usp_Learning_ListActiveUnits",null,CancellationToken.None));var impact=candidates.Where(x=>(string)x.status=="ACTIVE").Select(c=>new{id=(Guid)c.id,title=(string)c.title,activatedAt=c.activated_at,before=(int)c.evidence_count,after=(int?)null,applied=rules.FirstOrDefault(r=>(Guid?)r.source_candidate_id==(Guid)c.id)?.applied_count});return new{canReview=roles.Any(Reviewers.Contains),signals,candidates,rules,units,impact};}

    [HttpPost("candidate/decision")]
    public async Task<object>Candidate([FromBody]CandidateDecision r){var(actor,_)=await Require(Reviewers);await using var db=sql.Create();var c=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Learning_GetCandidate",r,CancellationToken.None))??throw new NotFoundException("Proposal not found");if(new[]{"APPROVED","ACTIVE","REJECTED"}.Contains((string)c.status))return new{ok=true,alreadyDecided=true};if(r.Decision is "REJECT" or "DEFER"){await db.ExecuteAsync(DbProc.Call("usp_Learning_UpdateCandidateDecision",new{status=r.Decision=="REJECT"?"REJECTED":"DEFERRED",r.Note,actor,r.CandidateId},CancellationToken.None));return new{ok=true,activated=false};}var change=Parse((string)c.proposed_change);var edits=r.Edits?.ValueKind==JsonValueKind.Object?r.Edits.Value:(JsonElement?)null;var kind=change.TryGetProperty("kind",out var k)?k.GetString():null;var activated=false;if(kind=="routing_rule"){var phrases=GetStrings(edits,"triggerPhrases");if(phrases.Length==0)phrases=GetStrings(change,"trigger_phrases");if(phrases.Length==0)throw new SanadiException("A routing rule needs at least one trigger phrase");await db.ExecuteAsync(DbProc.Call("usp_Learning_InsertRoutingRule",new{name=Get(edits,"title")??Get(change,"rule_name")??(string)c.title,context=(string?)c.pattern_key,phrases=JsonSerializer.Serialize(phrases),pending=Get(change,"pending_domain"),domain=Get(edits,"targetDomain")??Get(change,"target_domain"),unit=Guid.TryParse(Get(edits,"targetUnitId")??Get(change,"target_unit_id"),out var unit)?unit:(Guid?)null,priority=GetInt(edits,"priority")??GetInt(change,"priority")??100,confidence=(decimal)c.confidence,actor,source=(Guid)c.id},CancellationToken.None));activated=true;}await db.ExecuteAsync(DbProc.Call("usp_Learning_ActivateCandidate",new{title=Get(edits,"title"),r.Note,actor,r.CandidateId},CancellationToken.None));return new{ok=true,activated};}

    [HttpPost("rule/toggle")]
    public async Task<object>ToggleRule([FromBody]Toggle r){await Require(Reviewers);await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Learning_ToggleRule",r,CancellationToken.None));return new{ok=true};}

    [HttpPost("detect")]
    public async Task<object>Detect(){await Require(Reviewers);await using var db=sql.Create();var groups=await db.QueryAsync(DbProc.Call("usp_Learning_DetectGroups",null,CancellationToken.None));var created=0;foreach(var g in groups){var key=$"{g.correction_type}|{g.corrected_domain}|{g.corrected_unit_id}";var exists=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Learning_CandidateExistsByKey",new{key},CancellationToken.None));if(exists>0)continue;var id=Guid.NewGuid();var change=JsonSerializer.Serialize(new{kind="routing_rule",target_domain=(string?)g.corrected_domain,target_unit_id=(Guid?)g.corrected_unit_id,trigger_phrases=Array.Empty<string>(),priority=100});await db.ExecuteAsync(DbProc.Call("usp_Learning_CreateCandidateFromSignals",new{id,key,title=$"Improve routing for {g.correction_type}",evidence=(int)g.evidence,change,confidence=(decimal)g.confidence,type=(string)g.correction_type,domain=(string)g.corrected_domain},CancellationToken.None));created++;}return new{ok=true,details=new{created}};}

    [HttpPost("feedback")]
    public async Task<object>FeedbackSave([FromBody]Feedback r){if(r.Helpful)return new{ok=true,recorded=false};var id=User();var correction=r.ReasonCode switch{"wrong_route"=>"WRONG_ROUTING","wrong_answer"=>"RESPONSE_QUALITY","missing_information"=>"CLARIFICATION_GAP",_=>"RESPONSE_QUALITY"};await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Learning_InsertFeedbackSignal",new{correction,r.ConversationId,r.MessageId,id,r.Domain,r.UserText,r.Comment,r.ReasonCode},CancellationToken.None));return new{ok=true,recorded=true};}

    [HttpGet("routing")]
    public async Task<object>Routing(){var(_,roles)=await Require(Readers);await using var db=sql.Create();var rules=await db.QueryAsync(DbProc.Call("usp_Learning_ListRoutingRulesTop",null,CancellationToken.None));var decisions=await db.QueryAsync(DbProc.Call("usp_Learning_ListRuleDecisions",null,CancellationToken.None));var units=await db.QueryAsync(DbProc.Call("usp_Learning_ListActiveUnits",null,CancellationToken.None));var config=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Learning_GetConfig",null,CancellationToken.None));var metrics=await Metrics(db);return new{canReview=roles.Any(Reviewers.Contains),rules,decisions,units,config,metrics};}

    [HttpPost("routing/decision")]
    public async Task<object>Rule([FromBody]RuleDecision r){var(actor,_)=await Require(Reviewers);await using var db=sql.Create();var exists=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Learning_RuleExists",r,CancellationToken.None));if(exists==0)throw new NotFoundException("Rule not found");var status=r.Action switch{"ACTIVATE"=>"ACTIVE","APPROVE"=>"APPROVED","SHADOW"=>"SHADOW","PAUSE"=>"PAUSED","ROLLBACK"=>"ROLLED_BACK","REJECT"=>"REJECTED",_=>null};var edits=r.Edits?.ValueKind==JsonValueKind.Object?r.Edits.Value:(JsonElement?)null;await db.ExecuteAsync(DbProc.Call("usp_Learning_UpdateRoutingRule",new{r.RuleId,r.Reason,status,actor,name=Get(edits,"ruleName"),phrases=GetStrings(edits,"triggerPhrases") is var p&&p.Length>0?JsonSerializer.Serialize(p):null,domain=Get(edits,"targetDomain"),unit=Guid.TryParse(Get(edits,"targetUnitId"),out var u)?u:(Guid?)null,priority=GetInt(edits,"priority"),language=Get(edits,"sourceLanguage")},CancellationToken.None));return new{ok=true,status=status??"unchanged"};}

    [HttpPost("routing/run")]
    public async Task<object>RunRouting(){await Require(Reviewers);var detected=await Detect();await using var db=sql.Create();var evaluated=await db.ExecuteAsync(DbProc.Call("usp_Learning_EvaluateRules",null,CancellationToken.None));return new{built=new{shadowed=0,proposed=((dynamic)detected).details.created},evaluated=new{count=evaluated}};}

    [HttpPost("config")]
    public async Task<object>ConfigSave([FromBody]Config r){var(actor,_)=await Require(Reviewers);await using var db=sql.Create();var id=await db.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_Learning_GetConfigId",null,CancellationToken.None));if(id is null)await db.ExecuteAsync(DbProc.Call("usp_Learning_InsertConfig",new{r.ThresholdLow,r.ThresholdNormal,r.ThresholdHigh,r.MinHistoricalAccuracy,r.MinShadowSamples,r.MinShadowAccuracy,r.AutoActivationEnabled,r.PauseConfidence,actor},CancellationToken.None));else await db.ExecuteAsync(DbProc.Call("usp_Learning_UpdateConfig",new{id,r.ThresholdLow,r.ThresholdNormal,r.ThresholdHigh,r.MinHistoricalAccuracy,r.MinShadowSamples,r.MinShadowAccuracy,r.AutoActivationEnabled,r.PauseConfidence,actor},CancellationToken.None));return new{ok=true};}

    private static async Task<object>Metrics(System.Data.Common.DbConnection db){var total=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Learning_CountRules",null,CancellationToken.None));var active=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Learning_CountActiveRules",null,CancellationToken.None));var decisions=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Learning_CountDecisions",null,CancellationToken.None));return new{totalRules=total,activeRules=active,decisions};}
    private static JsonElement Parse(string? s){try{return JsonDocument.Parse(string.IsNullOrWhiteSpace(s)?"{}":s).RootElement.Clone();}catch{return JsonDocument.Parse("{}").RootElement.Clone();}}
    private static string?Get(JsonElement? e,string name)=>e is {ValueKind:JsonValueKind.Object}x&&x.TryGetProperty(name,out var v)&&v.ValueKind!=JsonValueKind.Null?v.ToString():null;
    private static int?GetInt(JsonElement? e,string name)=>int.TryParse(Get(e,name),out var n)?n:null;
    private static string[]GetStrings(JsonElement? e,string name)=>e is {ValueKind:JsonValueKind.Object}x&&x.TryGetProperty(name,out var v)&&v.ValueKind==JsonValueKind.Array?v.EnumerateArray().Select(z=>z.GetString()).Where(z=>!string.IsNullOrWhiteSpace(z)).Cast<string>().ToArray():[];
    private static string[]GetStrings(JsonElement e,string name)=>GetStrings((JsonElement?)e,name);
}

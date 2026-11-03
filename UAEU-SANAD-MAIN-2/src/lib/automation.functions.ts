import { apiFetch } from "@/lib/auth-token";
import { getOwnerUnitOperationsFn } from "@/lib/owner.functions";
const post=<T>(path:string,data:unknown)=>apiFetch<T>(`/api/automation/${path}`,{method:"POST",body:JSON.stringify(data)});
type AnyRow=Record<string,any>; type Ok={ok:true};
export const getOwnerConsoleFn=()=>apiFetch<{attention:AnyRow[];managed:AnyRow[];unmanaged:AnyRow[];preferences:AnyRow|null;impact:{autonomousCompletions:number;hoursSaved:number;aiActions:number};metrics:{automationRate:number|null;sampleSize:number;aiActions:number;humanActions:number;attentionCount:number;managedCount:number;editCounts:Record<string,number>;totalEdits:number}}>("/api/automation/console");
export const getCaseAutomationFn=({data}:{data:{caseId:string}})=>apiFetch<{state:AnyRow|null;events:Array<{id:string;action_key:string;actor_type:string;autonomy_level:string|null;rule_used:string|null;summary_en:string|null;summary_ar:string|null;executed:boolean;human_review_required:boolean;created_at:string}>}>(`/api/automation/cases/${data.caseId}`);
export const runCaseIntakeFn=({data}:{data:{caseId:string}})=>post<Ok&{assigneeId:string|null}>("intake",data);
export const setAutomationPauseFn=({data}:{data:{caseId:string;pause:boolean;reason?:string|undefined}})=>post<Ok&{paused:boolean}>("pause",{...data,reason:data.reason??""});
export const overrideAutomationFn=({data}:{data:{caseId:string;field:"unit"|"urgency"|"assignee"|"classification";value:string;reason:string}})=>post<Ok>("override",data);
export const prepareDraftFn=({data}:{data:{caseId:string}})=>post<{caseId:string;draft:string;language:"en"|"ar";autonomy:string;autoSendAllowed:boolean;reason:string;fallback:boolean}>("draft",data);
export const sendDraftFn=({data}:{data:{caseId:string;originalDraft:string;finalText:string;reason?:string|undefined}})=>post<Ok&{edited:boolean}>("draft/send",data);
export const saveOwnerPreferencesFn=({data}:{data:{auto_send_routine_updates:boolean;auto_request_missing_information:boolean;auto_follow_up:boolean;auto_escalate_by_policy:boolean;auto_prepare_resolution:boolean;auto_close_eligible_cases:boolean;require_review_for_all_student_messages:boolean;preferred_response_style:"concise_formal"|"warm_supportive"|"detailed_procedural"}})=>post<Ok>("preferences",{
  autoSendRoutineUpdates:data.auto_send_routine_updates,autoRequestMissingInformation:data.auto_request_missing_information,
  autoFollowUp:data.auto_follow_up,autoEscalateByPolicy:data.auto_escalate_by_policy,autoPrepareResolution:data.auto_prepare_resolution,
  autoCloseEligibleCases:data.auto_close_eligible_cases,requireReviewForAllStudentMessages:data.require_review_for_all_student_messages,
  preferredResponseStyle:data.preferred_response_style,
});
export const getAutomationPoliciesFn=()=>apiFetch<{policies:AnyRow[];followUps:AnyRow[]}>("/api/automation/policies");
export const setPolicyAutonomyFn=({data}:{data:{id:string;autonomyLevel:"automatic"|"automatic_notify"|"owner_approval"|"human_only"}})=>post<Ok>("policies/autonomy",data);
export const getOwnerOperationsFn=()=>getOwnerUnitOperationsFn({data:{}});
export const reportKnowledgeIssueFn=({data}:{data:{issueType:"incorrect_information"|"missing_information"|"outdated_policy"|"suggested_update";description:string}})=>post<Ok>("knowledge-issues",data);

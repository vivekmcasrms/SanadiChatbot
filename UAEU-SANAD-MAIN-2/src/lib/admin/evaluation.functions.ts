/** Shared evaluation DTOs. Evaluation operations are implemented by SanadiAPI. */
export const MIN_SAMPLE = 5;
export type Baseline = { id:string; universityServiceId:string; steps:number|null; forms:number|null; visits:number|null; fieldsRequested:number|null; avgProcessingHours:number|null; staffTouchpoints:number|null; channels:string[]; notes:string|null; updatedAt:string };
export type ServiceRow = { id:string; code:string; nameEn:string; nameAr:string; baseline:Baseline|null; cases:number; completed:number; avgResolutionHours:number|null };
export type PilotSession = { id:string; universityServiceId:string|null; serviceLabel:string|null; participantRole:string; participantCount:number; testedOn:string; completedSuccessfully:boolean; timeTakenMinutes:number|null; issues:string|null; satisfactionRating:number|null; comments:string|null };
export type Metrics = {
  range:{from:string;to:string};
  volumes:{interactions:number;chat_messages:number;conversations:number;cases:number;queries:number;complaints:number;suggestions:number;alerts:number;requests:number};
  handling:{ai_resolved:number;human_escalated:number;resolved:number;closed:number;open:number};
  timing:{first_response_sample:number;avg_first_response_hours:number|null;resolution_sample:number;avg_resolution_hours:number|null};
  sla:{sample:number;met:number}; effort:{staff_touchpoints:number;student_entered_fields:number;information_requests:number;reused_known_fields:number;status_transitions:number;in_person_visits:number};
  reviews:{decided_sample:number;reopen_or_objection:number};
  evidence:{baselines:number;pilot_sessions:number;pilot_participants:number;handovers:number;exception_events:number;approvals:number;action_receipts:number;reviews_by_kind:Record<string,number>;provenance_fields:number;issued_documents:number;revoked_accounts:number;assistant_conversations:number};
};
export type Indicator = { key:string; labelEn:string; labelAr:string; value:number|null; unit:"percent"|"hours"|"count"; sample:number; baselineValue?:number|null; currentValue?:number|null; reasonEn?:string; reasonAr?:string };
export type CriterionStatus = "complete"|"partial"|"not_complete"|"not_applicable";
export type Criterion = { key:string; labelEn:string; labelAr:string; status:CriterionStatus; evidenceEn:string[]; evidenceAr:string[]; missingEn:string[]; missingAr:string[] };
export type EvaluationSnapshot = { metrics:Metrics; services:ServiceRow[]; pilots:PilotSession[]; indicators:Indicator[]; readiness:Criterion[] };

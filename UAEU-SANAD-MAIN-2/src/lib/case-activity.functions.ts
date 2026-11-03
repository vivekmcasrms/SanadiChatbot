import { apiFetch } from "@/lib/auth-token";
export type CaseActivityEvent={at:string;en:string;ar:string;by:"sanadi"|"staff"|"you";actorEn?:string;actorAr?:string;resultEn?:string;resultAr?:string};
export const getCaseActivityFn=({data}:{data:{caseId:string}})=>apiFetch<CaseActivityEvent[]>(`/api/case-transparency/${encodeURIComponent(data.caseId)}/activity`);

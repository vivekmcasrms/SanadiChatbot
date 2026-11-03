import { apiFetch } from "@/lib/auth-token";

export type OwnerWorkspace = {
  units: Array<{ id: string; code: string; nameEn: string; nameAr: string; ownershipType: string; capabilities: string[] }>;
  roles: string[]; isOwner: boolean; isManager: boolean; seesAllUnits: boolean;
  actionsByUnit: Record<string, Array<{ code: string; enabled: boolean; requiresConfirmation: boolean; requiresReason: boolean; riskLevel: string }>>;
};

type UnitInput = { unitId?: string | null | undefined };
type AnyRow = Record<string, any>;
type OwnerCaseRow = AnyRow & { id:string; breached:boolean; status:string; urgency:string; case_type:string; case_number:string; title:string; created_at:string; last_activity_at:string|null };
type OwnerOpsItem = { id:string; caseNumber:string; title:string; status:string; urgency:string; caseType:string; studentName:string|null; unitNameEn:string|null; unitNameAr:string|null; lastActionEn:string|null; lastActionAr:string|null; nextActionEn:string|null; nextActionAr:string|null; nextActionAt:string|null; dueAt:string|null; slaHours:number|null; slaState:"on_track"|"attention"|"critical"|"breached"|"none"; responsible:"ai"|"owner"|"student"|"external"; attentionCategory:string|null };
const qs = (data: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k,v] of Object.entries(data)) if(v!==undefined&&v!==null)p.set(k,String(v)); return p.toString(); };

export const getOwnerWorkspaceFn = () => apiFetch<OwnerWorkspace>("/api/owner/workspace");
export const getOwnerUnitOverviewFn = ({ data }: { data: UnitInput }) => apiFetch<{
  unitIds: string[]; cases: OwnerCaseRow[]; attention: OwnerCaseRow[]; aiManaged: OwnerCaseRow[]; recent: OwnerCaseRow[];
  counts: { open:number; attention:number; aiManaged:number; atRisk:number; breached:number; waitingStudent:number; newToday:number };
}>(`/api/owner/overview?${qs(data)}`);
export const getOwnerUnitInsightsFn = ({ data }: { data: UnitInput }) => apiFetch<{
  totalCases:number; byType:Array<{type:string;count:number}>; automationRate:number|null; slaCompliance:number|null;
  avgResolutionHours:number|null; topTopics:Array<{label:string;count:number}>; topRootCauses:Array<{label:string;count:number}>;
}>(`/api/owner/insights?${qs(data)}`);
export const getOwnerUnitOperationsFn = ({ data }: { data: UnitInput }) => apiFetch<{
  items:OwnerOpsItem[]; followUp:{dueToday:OwnerOpsItem[];overdue:OwnerOpsItem[];waitingStudent:OwnerOpsItem[];waitingExternal:OwnerOpsItem[];aiScheduled:OwnerOpsItem[];needsOwnerAction:OwnerOpsItem[]};
  sla:{breached:OwnerOpsItem[];critical:OwnerOpsItem[];attention:OwnerOpsItem[];onTrack:number;escalated:string[];aiHandled:number;humanNeeded:number}; escalations:OwnerOpsItem[];
}>(`/api/owner/operations?${qs(data)}`);
export const getOwnerUnitChatsFn = ({ data }: { data: UnitInput }) => apiFetch<AnyRow[]>(`/api/owner/chats?${qs(data)}`);
export const reportMisroutingFn = ({ data }: { data: { caseId:string; correctedUnitId?:string|null|undefined; reason:string } }) => apiFetch<{ok:true;reassigned:boolean}>("/api/owner/misrouting",{method:"POST",body:JSON.stringify(data)});
export const getOwnerDashboardFn = ({ data }: { data: UnitInput & { days?:number|undefined } }) => apiFetch<{
  unitIds:string[];since:string;byType:{query:number;complaint:number;suggestion:number;alert:number;service_request:number};
  byStatus:{open:number;inProgress:number;waitingStudent:number;resolved:number;closed:number};total:number;attention:number;
  recent:Array<{id:string;case_number:string;case_type:string;title:string;status:string;urgency:string;created_at:string;last_activity_at:string|null}>;
}>(`/api/owner/dashboard?${qs(data)}`);

import { apiFetch } from "@/lib/auth-token";
import type { InteractionClassification, InteractionType } from "./interactions/types";

type Input = {
  title: string; description: string; shortcutHint?: InteractionType | null;
  urgencyHint?: "low" | "medium" | "high" | "critical" | null;
  categoryId?: string | null; unitId?: string | null; desiredResolution?: string | null;
  expectedBenefit?: string | null; incidentDate?: string | null; confidentiality?: string | null;
  isAnonymous?: boolean; location?: string | null; conversationId?: string | null; lang?: "en" | "ar";
};
type Result = { kind:"case"|"suggestion"; id:string; reference:string; interactionType:InteractionType; classification:InteractionClassification; trackingUrl:string; acknowledgementEn:string; acknowledgementAr:string; emergencyContacts:Array<{label:string;phone:string|null;url:string|null}>; linkedSuggestionId:string|null; clarifyingQuestionEn?:string|null; clarifyingQuestionAr?:string|null };

export const previewInteractionFn = ({data,signal}:{data:Pick<Input,"title"|"description"|"shortcutHint"|"urgencyHint"|"categoryId"|"unitId">;signal?:AbortSignal}) =>
  apiFetch<InteractionClassification>("/api/interactions/preview",{method:"POST",body:JSON.stringify(data),signal});
export const submitInteractionFn = ({data}:{data:Input}) =>
  apiFetch<Result>("/api/interactions",{method:"POST",body:JSON.stringify({...data,lang:data.lang??"en"})});
export const getEmergencyPathwaysFn = ({data}:{data:{lang?:"en"|"ar"}}) =>
  apiFetch<Array<{label:string;phone:string|null;url:string|null}>>(`/api/interactions/emergency-pathways?lang=${data.lang??"en"}`);
export const convertQueryToComplaintFn = ({data}:{data:{caseId:string;reason:string}}) =>
  apiFetch<{ok:boolean;reference?:string}>("/api/interactions/convert-to-complaint",{method:"POST",body:JSON.stringify(data)});

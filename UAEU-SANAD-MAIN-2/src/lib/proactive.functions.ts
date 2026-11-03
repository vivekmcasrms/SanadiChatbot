import { apiFetch } from "@/lib/auth-token";
export type SuggestionTheme={key:string;labelEn:string;labelAr:string;count:number;votes:number;unitId:string|null;unitNameEn:string|null;unitNameAr:string|null;oldestAt:string;items:{id:string;referenceNumber:string;title:string;status:string;votes:number;createdAt:string}[]};
export const refreshMyProactiveAlerts=()=>apiFetch<{created:number;types:string[];closed:number}>("/api/proactive/refresh",{method:"POST"});
export const getSuggestionThemes=()=>apiFetch<SuggestionTheme[]>("/api/proactive/suggestion-themes");

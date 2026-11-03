import { apiFetch } from "@/lib/auth-token";
export type AcceptanceStatus="pass"|"attention";
export type AcceptanceCheck={id:string;area:string;title:{en:string;ar:string};status:AcceptanceStatus;evidence:{en:string;ar:string};link?:string};
export type AcceptanceResult={checks:AcceptanceCheck[];ranAt:string};
export const runAcceptanceChecksFn=()=>apiFetch<AcceptanceResult>("/api/acceptance/checks",{method:"POST"});

import { apiFetch } from "@/lib/auth-token";

const post = <T>(path: string, data: unknown) => apiFetch<T>(`/api/suggestions/${path}`, {
  method: "POST",
  body: JSON.stringify(data),
});

export const intakeSuggestionFn = ({ data }: { data: { suggestionId: string } }) =>
  post<{ unitId: string | null; assigneeId: string | null }>("intake", data);

export const acknowledgeSuggestionFn = ({ data }: { data: { suggestionId: string; note?: string | undefined } }) =>
  post<{ ok: true }>("acknowledge", data);

export const assignSuggestionFn = ({ data }: { data: { suggestionId: string; assigneeId?: string | null | undefined } }) =>
  post<{ ok: true; assigneeId: string }>("assign", data);

export const assessSuggestionFn = ({ data }: { data: {
  suggestionId: string; impact: number; feasibility: number; alignment: number;
  costBand?: string | null | undefined; complexity?: string | null | undefined;
  recommendation: "approve" | "pilot" | "defer" | "decline";
  rationale?: string | null | undefined;
} }) => post<{ ok: true }>("assess", data);

export const decideSuggestionFn = ({ data }: { data: {
  suggestionId: string; decision: "planned" | "implemented" | "not_proceeding" | "closed";
  outcomeEn: string; outcomeAr?: string | null | undefined; targetDate?: string | null | undefined;
} }) => post<{ ok: true }>("decide", data);

export const postSuggestionUpdateFn = ({ data }: { data: {
  suggestionId: string; textEn: string; textAr?: string | null | undefined; visibleToStudent?: boolean | undefined;
} }) => post<{ ok: true }>("updates", { ...data, visibleToStudent: data.visibleToStudent ?? true });

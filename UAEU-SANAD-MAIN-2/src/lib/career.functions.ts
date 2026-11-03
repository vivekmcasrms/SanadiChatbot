import { apiFetch } from "@/lib/auth-token";
import type { CareerAnalysis, CareerPreferences } from "./career/career.server";
import type { Database } from "@/integrations/supabase/types";

type Call<T> = { data: T };
type CareerState = {
  analysis: CareerAnalysis;
  preferences: CareerPreferences & { latestCvId: string | null; counsellorRequested: boolean };
};
type CounsellingState = { id: string; reference: string; status: string; createdAt: string; firstResponseDueAt: string | null; resolutionDueAt: string | null };
type UploadResult = { cvId: string; parsingStatus: string; parsingError: string | null; discrepancies: string[]; analysis: CareerAnalysis };

export const getMyCareerState = (): Promise<CareerState> => apiFetch("/api/career/state");

export const uploadMyCv = ({ data }: Call<{ fileName: string; mimeType: string; content: string }>): Promise<UploadResult> =>
  apiFetch("/api/career/cv", { method: "POST", body: JSON.stringify(data) });

export const saveMyCareerPreferences = ({ data }: Call<{
  preferredRoles?: string[];
  preferredFields?: string[];
  preferredSectors?: string[];
  preferredLocations?: string[];
  workMode?: "onsite" | "hybrid" | "remote" | "any";
  workOrientation?: "industry" | "research" | "government" | "entrepreneurship" | "undecided";
}>): Promise<CareerAnalysis> => apiFetch("/api/career/preferences", { method: "POST", body: JSON.stringify(data) });

export const analyseMyCareerFit = ({ data }: Call<{ targetRoleCode?: string | null }>): Promise<CareerAnalysis> =>
  apiFetch("/api/career/analyse", { method: "POST", body: JSON.stringify(data) });

export const listCareerRoles = (): Promise<Array<Pick<Database["public"]["Tables"]["career_roles"]["Row"], "id" | "role_code" | "title_en" | "title_ar" | "career_family" | "industry_sectors" | "required_hard_skills" | "certifications">>> => apiFetch("/api/career/roles");
export const getMyCounsellingRequest = async (): Promise<CounsellingState | null> => {
  // The API may return 204 when no request exists; React Query needs explicit null.
  const request = await apiFetch<CounsellingState | null | undefined>("/api/career/counselling");
  return request ?? null;
};

export const requestCareerCounsellor = ({ data }: Call<{ note?: string; lang?: "en" | "ar" }>): Promise<{ created: boolean; request: CounsellingState; acknowledgement: string }> =>
  apiFetch("/api/career/counselling", { method: "POST", body: JSON.stringify(data) });

export const getMyCvDownloadUrl = ({ data }: Call<{ cvId: string }>): Promise<{ url: string }> =>
  apiFetch("/api/career/cv/download", { method: "POST", body: JSON.stringify(data) });

export const deleteMyCv = (_input?: { data?: undefined }): Promise<{ ok: boolean; analysis: CareerAnalysis }> =>
  apiFetch("/api/career/cv", { method: "DELETE" });

import { apiFetch } from "@/lib/auth-token";

export type DemoAccountStatus = {
  email: string; nameEn: string; nameAr: string; kind: "student" | "staff";
  role: string; unit: string | null; jobEn: string | null; jobAr: string | null;
  isOwner: boolean; scenario: string | null; provisioned: boolean; lastSignInAt: string | null;
};

/** Administrative status is resolved by the C# API from provisioned demo identities. */
export const getDemoAccountStatus = () => apiFetch<{
  accounts: DemoAccountStatus[]; staffPassword: string; studentPassword: string;
}>("/api/demo/accounts");

/**
 * One evidence status per answer, derived only from what actually ran.
 * Student-record evidence and official-policy evidence are reported separately;
 * an answer that used only the student record never implies a policy document was consulted.
 */
export type EvidenceInput = {
  verified: boolean;
  toolsUsed: string[];
  citations: { documentId: string | null }[];
  hasProposals: boolean;
};
export type EvidenceKind = "record_and_policy" | "policy" | "record" | "record_policy_unavailable" | "unverified" | "none";

export function evidenceStatus(r: EvidenceInput): EvidenceKind {
  const policy = r.citations.some((c) => Boolean(c.documentId));
  const record = r.toolsUsed.length > 0 || r.citations.some((c) => !c.documentId);
  if (policy && record) return "record_and_policy";
  if (policy) return "policy";
  if (record) return r.verified ? "record" : "record_policy_unavailable";
  if (r.hasProposals) return "none";
  return r.verified ? "none" : "unverified";
}

export const EVIDENCE_LABEL: Record<Exclude<EvidenceKind, "none">, { en: string; ar: string }> = {
  record_and_policy: { en: "Verified from your student record and official policy.", ar: "تم التحقق من سجلك الطلابي ومن السياسة الرسمية." },
  policy: { en: "Verified against official policy.", ar: "تم التحقق مقابل السياسة الرسمية." },
  record: { en: "Verified from your student record.", ar: "تم التحقق من سجلك الطلابي." },
  record_policy_unavailable: {
    en: "Verified from your student record. Policy source unavailable.",
    ar: "تم التحقق من سجلك الطلابي. مصدر السياسة غير متاح.",
  },
  unverified: {
    en: "I could not verify this against an official university document. I can open a case so a staff member reviews it.",
    ar: "لم أتمكن من التحقق من ذلك في وثيقة جامعية رسمية. يمكنني فتح حالة ليراجعها موظف مختص.",
  },
};

/** Language of a single message: controls follow the message, not the app setting. */
export function messageLang(text: string, fallback: "en" | "ar"): "en" | "ar" {
  const t = text ?? "";
  const ar = (t.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  if (!ar && !latin) return fallback;
  return ar >= latin * 0.5 ? "ar" : "en";
}

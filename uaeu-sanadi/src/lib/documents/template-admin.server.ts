/** Administrator editing and preview of issued-document templates. Server only. */

export const TEMPLATE_PLACEHOLDERS = [
  "{{student_name}}",
  "{{student_id}}",
  "{{programme}}",
  "{{college}}",
  "{{academic_term}}",
  "{{issue_date}}",
  "{{reference_number}}",
] as const;

const SAMPLE_EN: Record<string, string> = {
  student_name: "Saif Al Shamsi",
  student_id: "202312345",
  programme: "Bachelor of Science in Computer Science",
  college: "College of Information Technology",
  academic_term: "Spring 2026",
  issue_date: "20 August 2026",
  reference_number: "UAEU-TWIMC-2026-000123",
};

const SAMPLE_AR: Record<string, string> = {
  student_name: "سيف الشامسي",
  student_id: "202312345",
  programme: "بكالوريوس العلوم في علوم الحاسوب",
  college: "كلية تقنية المعلومات",
  academic_term: "فصل الربيع 2026",
  issue_date: "٢٠ أغسطس ٢٠٢٦",
  reference_number: "UAEU-TWIMC-2026-000123",
};

export type TemplateDraft = {
  title: string;
  headerText: string | null;
  bodyTemplate: string;
  footerText: string | null;
  signatoryBlock: string | null;
  disclaimer: string | null;
  validityDays: number | null;
};

/** Fills a draft with representative sample data so an administrator can read the result. */
export function renderTemplatePreview(draft: TemplateDraft, language: "en" | "ar") {
  const sample = language === "ar" ? SAMPLE_AR : SAMPLE_EN;
  const fill = (text: string | null) =>
    (text ?? "").replace(/\{\{(\w+)\}\}/g, (whole, key: string) => sample[key] ?? whole);

  const unknown = Array.from(draft.bodyTemplate.matchAll(/\{\{(\w+)\}\}/g))
    .map((m) => m[1]!)
    .filter((k) => !(k in SAMPLE_EN));

  return {
    title: fill(draft.title),
    header: fill(draft.headerText),
    body: fill(draft.bodyTemplate),
    footer: fill(draft.footerText),
    signatory: fill(draft.signatoryBlock),
    disclaimer: fill(draft.disclaimer),
    unknownPlaceholders: Array.from(new Set(unknown)),
  };
}

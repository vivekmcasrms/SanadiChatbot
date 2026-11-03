/**
 * Label for a bilingual content field, in the active UI language. The content
 * language is named in words ("English"/"بالإنجليزية"), never as "(EN)"/"(AR)".
 */
export function contentFieldLabel(en: string, arLabel: string, content: "en" | "ar", uiAr: boolean): string {
  if (uiAr) return `${arLabel} ${content === "en" ? "بالإنجليزية" : "بالعربية"}`;
  return `${en} (${content === "en" ? "English" : "Arabic"})`;
}

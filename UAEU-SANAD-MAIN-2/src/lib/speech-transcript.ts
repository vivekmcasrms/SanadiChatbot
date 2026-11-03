/** Reuse only a browser transcript captured in, and matching, the requested language. */
export function browserTranscriptForLanguage(result: { language: "en" | "ar"; text: string } | undefined,
  language: "en" | "ar"): string | null {
  const text = result?.text.trim() ?? "";
  const matchesScript = language === "ar" ? /[\u0621-\u064a]/u.test(text)
    : /[a-z]/i.test(text) && !/[\u0621-\u064a]/u.test(text);
  return result?.language === language && matchesScript ? text : null;
}

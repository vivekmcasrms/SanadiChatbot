const aliases: [RegExp, string][] = [
  [/data science|علوم البيانات|علم البيانات/i, "data science"],
  [/computer science|علوم الحاسوب|علوم الحاسب/i, "computer science"],
  [/biology|علم الأحياء|علم الاحياء|علوم الأحياء|علوم الاحياء/i, "biology"],
  [/engineering|الهندسة|هندسة/i, "engineering"],
  [/college of it|information technology|كلية تقنية المعلومات/i, "information technology"],
];

export function matchesProgramme(text: string, programme: {code: string; name_en: string; name_ar: string}, collegeName?: string) {
  const normalized = text.toLowerCase();
  return normalized.includes(programme.name_en.toLowerCase()) || normalized.includes(programme.name_ar) ||
    new RegExp(`(?:^|\\s)${programme.code}(?:$|\\s|[.,?!])`, "i").test(text) ||
    aliases.some(([pattern, name]) => pattern.test(text) &&
      (programme.name_en.toLowerCase().includes(name) || collegeName?.toLowerCase().includes(name)));
}
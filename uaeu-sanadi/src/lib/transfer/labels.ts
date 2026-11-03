/** Client-safe bilingual labels for transfer entry requirements. */
export const entryLabels: Record<string, [string, string]> = {
  high_school: ["High school percentage", "نسبة الثانوية"],
  algebra: ["Algebra", "الجبر"],
  calculus: ["Calculus", "التفاضل والتكامل"],
  physics: ["Physics", "الفيزياء"],
  english: ["English", "اللغة الإنجليزية"],
  mathematics: ["Mathematics", "الرياضيات"],
  gpa: ["GPA", "المعدل"],
  completed_credits: ["Completed credits", "الساعات المكتملة"],
  previous_transfers: ["Previous transfers", "مرات التحويل السابقة"],
};
export function requirementLabel(field: string, ar: boolean): string {
  const l = entryLabels[field];
  if (l) return ar ? l[1] : l[0];
  // Unknown codes never show raw snake_case.
  const words = field.replace(/_/g, " ");
  return ar ? "متطلب آخر" : words.charAt(0).toUpperCase() + words.slice(1);
}

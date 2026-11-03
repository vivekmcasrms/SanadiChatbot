export const TRANSFER_RULE_VERSION = "transfer-v1";
export const isTransferIntent = (text: string) => /\b(transfer|switch|move|change)\b.{0,80}\b(program(?:me)?|college|major|engineering|computer science|data science|IT)\b|\b(?:programme?|college|major) transfer\b|\b(?:completed courses|credits|graduation)\b.{0,60}\btransfer\b|(?:تحويل|التحويل|أحول|أحوّل|انتقل|أنتقل|أغير|تغيير).{0,80}(?:كلية|الكليات|تخصص|برنامج|هندسة|الحاسب|الحاسوب|علوم البيانات)/i.test(text);
export type TransferFacts = { credits: number | null; gpa: number | null; previousTransfers: number | null; requirements: { label: string; minimum: number; actual: number | null }[]; rulesVerified: boolean; serviceOpen: boolean | null; accepting: boolean | null; seats: number | null };
export function evaluateTransfer(f: TransferFacts) {
  const failures: string[] = [];
  if (f.credits === null) failures.push("credits_unavailable");
  else { if (f.credits < 12) failures.push("below_minimum_credits"); if (f.credits > 36) failures.push("above_maximum_credits"); }
  if (f.gpa === null) failures.push("gpa_unavailable"); else if (f.gpa < 2.50) failures.push("gpa_below_minimum");
  if (f.previousTransfers === null) failures.push("history_unavailable"); else if (f.previousTransfers > 0) failures.push("previous_transfer_exists");
  if (!f.rulesVerified) failures.push("target_rules_unavailable");
  for (const r of f.requirements) if (r.actual === null || r.actual < r.minimum) failures.push(`${r.label}:${r.actual === null ? "unavailable" : "below_minimum"}`);
  const academicallyEligible = failures.length === 0;
  const operational: string[] = [];
  if (f.serviceOpen !== true) operational.push(f.serviceOpen === null ? "service_unavailable" : "service_closed");
  if (f.accepting !== true) operational.push(f.accepting === null ? "target_status_unavailable" : "target_not_accepting");
  if (f.seats === null) operational.push("capacity_unavailable"); else if (f.seats < 1) operational.push("no_available_seats");
  return { academicallyEligible, canSubmit: academicallyEligible && operational.length === 0, failures, operational };
}
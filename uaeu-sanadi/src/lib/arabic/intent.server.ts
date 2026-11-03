import { isHostelIntent } from "@/lib/hostel/rules";
import { isTransferIntent } from "@/lib/transfer/rules";
import { detectCaseReference } from "@/lib/agent/case-reference.server";
import { detectComplaintOpening } from "@/lib/agent/complaint-intake.server";
import { isSuggestionIntent } from "@/lib/agent/suggestion-intent.server";
import { detectAcademicProgressIntent } from "@/lib/agent/academic-progress.server";
import { detectCareerChatTopic } from "@/lib/career/chat.server";
import { isLibraryIntent } from "@/lib/agent/book-intent.server";
import { detectDomains } from "@/lib/agent/context.server";

/** Same deterministic matchers the assistant uses, summarised to one label for review. */
export function classifyStudentIntent(text: string): string {
  if (detectCaseReference(text)) return "case_status";
  if (isTransferIntent(text)) return "transfer";
  if (isHostelIntent(text)) return "hostel";
  if (detectComplaintOpening(text)) return "complaint";
  if (isSuggestionIntent(text)) return "suggestion";
  if (isLibraryIntent(text)) return "library";
  if (detectAcademicProgressIntent(text)) return "academic";
  if (detectCareerChatTopic(text)) return "career";
  const d = detectDomains(text);
  if (d.includes("cases")) return "case_status";
  if (d.includes("academic")) return "academic";
  return d[0] ?? "general";
}

import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import type { ChatContinuity } from "@/lib/chat-continuity.functions";

/**
 * Shown at the top of a reopened conversation so the student can see, in one
 * line, what this conversation was about, which request it belongs to, who is
 * handling it and anything still waiting on them. Everything here comes from
 * the saved conversation and the live request — nothing is kept in the page.
 */
export function ContinuityBanner({
  continuity,
  lang,
}: {
  continuity: ChatContinuity;
  lang: "en" | "ar";
}) {
  const ar = lang === "ar";
  const topic = ar ? continuity.topicAr ?? continuity.topicEn : continuity.topicEn;
  const c = continuity.linkedCase;
  const hasSomething =
    Boolean(topic) || Boolean(c) || Boolean(continuity.openQuestion) || continuity.documentCount > 0;
  if (!hasSomething) return null;

  const when = continuity.updatedAt
    ? new Date(continuity.updatedAt).toLocaleString(ar ? "ar-AE" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs" dir={ar ? "rtl" : "ltr"}>
      <p className="flex items-center gap-1.5 font-semibold text-primary">
        <History className="size-3.5" aria-hidden />
        {ar ? "أكملنا من حيث توقفت" : "Continuing where you left off"}
        {when ? <span className="font-normal text-muted-foreground">· {when}</span> : null}
      </p>

      <ul className="mt-2 space-y-1">
        {topic ? (
          <li>
            <span className="text-muted-foreground">{ar ? "الموضوع" : "Topic"}:</span> {topic}
          </li>
        ) : null}

        {c ? (
          <li>
            <span className="text-muted-foreground">{ar ? "الطلب" : "Request"}:</span>{" "}
            <Link to="/requests/$caseId" params={{ caseId: c.caseId }} className="font-mono underline">
              {c.caseNumber}
            </Link>{" "}
            · {ar ? c.statusAr : c.statusEn}
            {c.staffName ? ` · ${ar ? "يتابعه" : "handled by"} ${c.staffName}` : ""}
            {!c.staffName && (ar ? c.unitAr : c.unitEn)
              ? ` · ${ar ? c.unitAr : c.unitEn}`
              : ""}
          </li>
        ) : null}

        {continuity.documentCount > 0 ? (
          <li className="text-muted-foreground">
            {ar
              ? `${continuity.documentCount} مستند صادر محفوظ في هذه المحادثة`
              : `${continuity.documentCount} issued document${continuity.documentCount > 1 ? "s" : ""} saved in this conversation`}
          </li>
        ) : null}

        {continuity.openQuestion ? (
          <li className="font-medium">
            {ar ? "ما زلنا بانتظار" : "Still waiting on you"}: {continuity.openQuestion}
          </li>
        ) : continuity.awaitingApproval ? (
          <li className="font-medium">
            {ar ? "هناك إجراء بانتظار موافقتك." : "There is an action waiting for your approval."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

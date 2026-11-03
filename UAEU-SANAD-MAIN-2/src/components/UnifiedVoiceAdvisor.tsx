import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { VoiceChatMic, VoiceChatStatusBar, type VoiceChatMicControl, type VoiceChatActivity } from "./VoiceChatMic";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { ActionConfirmDialog } from "./ActionConfirmDialog";
import { IssuedDocumentCard } from "./IssuedDocumentCard";
import { LibraryResultsCard } from "./LibraryResultsCard";
import { CareerInsightCard } from "./CareerInsightCard";
import { Button } from "./ui/button";
import type { AgentResponse, ProposedAction } from "@/lib/agent-types";

/** Both entry points use VoiceChatMic and the same authenticated C# call protocol. */
export function UnifiedVoiceAdvisor() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const mic = useRef<VoiceChatMicControl>(null);
  const [agent, setAgent] = useState<"mira" | "suhail">("mira");
  const [language, setLanguage] = useState<"en" | "ar">(lang === "ar" ? "ar" : "en");
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const chat = new URLSearchParams(window.location.search).get("chat");
    return chat && /^[a-f0-9-]{36}$/i.test(chat) ? chat : null;
  });
  const [activity, setActivity] = useState<VoiceChatActivity | null>(null);
  const [preview, setPreview] = useState("");
  const [spoken, setSpoken] = useState("");
  const [turns, setTurns] = useState<Array<{ question: string; response: AgentResponse }>>([]);
  const question = useRef("");
  const [proposal, setProposal] = useState<{ action: ProposedAction; response: AgentResponse } | null>(null);
  const [notice, setNotice] = useState("");
  if (!user) return <main className="mx-auto max-w-3xl p-6"><p>{ar ? "سجّل الدخول لاستخدام المحادثة الصوتية." : "Sign in to use voice chat."}</p><Link to="/assistant">{ar ? "فتح المساعد" : "Open assistant"}</Link></main>;
  return <main dir={ar ? "rtl" : "ltr"} className="mx-auto max-w-3xl space-y-5 p-6">
    <Link to="/assistant" search={{ chat: conversationId ?? undefined }}>{ar ? "متابعة بالكتابة" : "Continue in text chat"}</Link>
    <h1 className="text-2xl font-semibold">{ar ? "تحدث مع سندي" : "Talk to Sanadi"}</h1>
    <p>{ar ? "تحدث بشكل طبيعي وتوقف عند انتهاء السؤال. يمكنك مقاطعة الرد. راجع التفاصيل قبل تأكيد أي إجراء." : "Speak naturally and pause when finished. You can interrupt a reply. Review the details before confirming an action."}</p>
    <div className="flex gap-3">
      <label>{ar ? "الصوت" : "Voice"} <select className="rounded border bg-background p-2" value={agent} onChange={e => setAgent(e.target.value as typeof agent)}><option value="mira">Mira</option><option value="suhail">Suhail</option></select></label>
      <label>{ar ? "لغة الرد" : "Reply language"} <select className="rounded border bg-background p-2" value={language} onChange={e => setLanguage(e.target.value as typeof language)}><option value="en">English</option><option value="ar">العربية</option></select></label>
    </div>
    <div className={activity ? "hidden" : ""}>
      <VoiceChatMic ref={mic} agent={agent} language={language} conversationId={conversationId} disabled={Boolean(proposal)}
        onTranscript={text => { question.current = text; setPreview(text); setSpoken(""); }}
        onTranscriptPreview={setPreview} onSpeech={text => setSpoken(previous => `${previous} ${text}`.trim())}
        onResult={response => {
          setConversationId(response.conversationId);
          setTurns(previous => [...previous, { question: question.current, response }].slice(-30));
          if (response.conversationId) window.history.replaceState(null, "", `/voice?chat=${encodeURIComponent(response.conversationId)}`);
        }} onActivity={setActivity} onEnd={() => { setPreview(""); setSpoken(""); }} />
    </div>
    {activity && <VoiceChatStatusBar agent={agent} activity={activity} onInterrupt={() => mic.current?.interrupt()} onMute={() => mic.current?.toggleMute()} onEnd={() => mic.current?.stop()} />}
    {preview && <p dir="auto" aria-live="polite">{preview}</p>}
    {spoken && <p dir="auto">{spoken}</p>}
    {notice && <p role="status">{notice}</p>}
    {turns.map(({ question: asked, response }, index) => <section key={response.messageId ?? index} className="space-y-3 rounded-xl border bg-card p-4" dir="auto">
      <p className="font-medium">{asked}</p><AssistantMarkdown>{response.answer}</AssistantMarkdown>
      {response.proposedActions?.map(action => <Button key={action.key} variant="outline" onClick={() => { mic.current?.stop(); setProposal({ action, response }); }}>{ar ? action.labelAr : action.labelEn}</Button>)}
      {response.receipt && <div role="status"><p>{response.receipt.referenceNumber ?? response.receipt.receiptNumber}</p><p>{response.receipt.nextStep}</p></div>}
      {response.issuedDocument && <IssuedDocumentCard document={response.issuedDocument} />}
      {response.libraryResults && <LibraryResultsCard card={response.libraryResults} lang={language} />}
      {response.careerInsight && <CareerInsightCard insight={response.careerInsight} />}
      {response.caseResult && <div><p>{response.caseResult.reference} · {response.caseResult.statusLabel}</p><p>{response.caseResult.outcome}</p><p>{response.caseResult.explanation}</p>
        <Link to="/assistant" search={{ chat: conversationId ?? undefined }}>{ar ? "متابعة الطلب" : "Follow up on this request"}</Link></div>}
    </section>)}
    <ActionConfirmDialog action={proposal?.action ?? null} open={Boolean(proposal)} conversationId={conversationId}
      messageId={proposal?.response.messageId ?? null} language={language} onOpenChange={open => { if (!open) setProposal(null); }}
      onConfirmed={(_, result) => {
        setNotice(result.message);
        if (proposal) setTurns(previous => [...previous, { question: "", response: {
          ...proposal.response, messageId: null, answer: result.message, proposedActions: [],
          receipt: result.receipt, issuedDocument: result.document ?? null, libraryResults: null, careerInsight: null, caseResult: null,
        } }]);
        setProposal(null);
      }} />
  </main>;
}

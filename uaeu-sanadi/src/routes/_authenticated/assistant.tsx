import { AssistantWorking } from "@/components/AssistantProgress";
import { AssistantActivity } from "@/components/AssistantActivity";
import { toastError } from "@/lib/errors/toast";
import { SanadiAvatar } from "@/components/SanadiAvatar";
import { useAssistantLevel, useAssistantState } from "@/lib/assistant-state";
import { useEffect, useMemo, useRef, useState } from "react";
import { listCompletedChatActionsFn } from "@/lib/chat-actions.functions";
import { isOneTimeAction, submittedLabel, uiActionKey } from "@/lib/agent/one-time-actions";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  Paperclip,
  Paperclip as PaperclipIcon,
  Send,
  ShieldAlert,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusChip } from "@/components/StatusChip";
import { ActionConfirmDialog } from "@/components/ActionConfirmDialog";
import { AssistantMarkdown, UserMessageBubble } from "@/components/AssistantMarkdown";
import { IssuedDocumentCard } from "@/components/IssuedDocumentCard";
import { CareerInsightCard } from "@/components/CareerInsightCard";
import { LibraryResultsCard } from "@/components/LibraryResultsCard";
import { CaseResultCard } from "@/components/CaseResultCard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { AgentResponse, ChatAttachment, ProposedAction } from "@/lib/agent-types";
import { streamAssistant } from "@/lib/assistant-stream";
import { getMyChatMessages, listMyChats } from "@/lib/chat-history.functions";
import { getChatContinuityFn } from "@/lib/chat-continuity.functions";
import { ContinuityBanner } from "@/components/ContinuityBanner";
import { getStudentBriefing } from "@/lib/student-briefing.functions";
import { VoiceInput, type VoiceMeta } from "@/components/VoiceInput";
import { ListenButton } from "@/components/ListenButton";
import { speakReply, stopSpeaking } from "@/lib/voice/playback";
import { TalkToSanadi } from "@/components/TalkToSanadi";
import { spokenSummary } from "@/lib/voice/spoken-summary";
import { useVoiceSettings } from "@/lib/voice-settings";
import { detectSpokenLanguage } from "@/lib/voice/normalize";

import { translate as tr } from "@/lib/i18n";
import { evidenceStatus, EVIDENCE_LABEL, messageLang } from "@/lib/evidence-status";

export const Route = createFileRoute("/_authenticated/assistant")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { chat?: string | undefined; ask?: string | undefined; draft?: string | undefined; unit?: string | undefined } => ({
    chat: typeof search["chat"] === "string" ? (search["chat"] as string) : undefined,
    ask: typeof search["ask"] === "string" ? (search["ask"] as string) : undefined,
    draft: typeof search["draft"] === "string" ? (search["draft"] as string) : undefined,
    unit:
      typeof search["unit"] === "string" && /^[0-9a-f-]{36}$/i.test(search["unit"] as string)
        ? (search["unit"] as string)
        : undefined,
  }),

  head: () => ({
    meta: [
      { title: "Assistant — Sanadi | UAEU" },
      {
        name: "description",
        content:
          "Talk to the UAEU student service assistant in Arabic or English and get verified answers.",
      },
      { property: "og:title", content: "Assistant — Sanadi | UAEU" },
      { property: "og:description", content: "Verified answers and tracked student cases." },
    ],
  }),
  component: AssistantPage,
});

type ChatMessage =
  | { role: "user"; content: string; id?: string }
  | {
      role: "assistant";
      content: string;
      response?: AgentResponse;
      /** Stable id so streamed text is always written to the same bubble. */
      id?: string;
      /** streaming → tokens arriving, finalizing → verification pass running. */
      phase?: "streaming" | "finalizing" | "done" | "failed";
    };


function AssistantPage() {
  const { t, lang } = useI18n();
  const msgLang = (m: { content: string; response?: { answer?: string } | null }) =>
    messageLang(m.response?.answer || m.content, lang);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { chat: chatParam, ask: askParam, draft: draftParam, unit: unitParam } = Route.useSearch();
  const navigateSearch = Route.useNavigate();
  // Selected-unit context from the campus directory: validated against the
  // authoritative unit record. It only frames the question; it grants no permission.
  const unitQuery = useQuery({
    queryKey: ["assistant-unit-context", unitParam],
    enabled: Boolean(unitParam),
    queryFn: async () => {
      const { data } = await supabase
        .from("service_units")
        .select("id, name_en, name_ar")
        .eq("id", unitParam!)
        .eq("is_active", true)
        .maybeSingle();
      return data ?? null;
    },
  });
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const voiceState = useAssistantState();
  const voiceLevel = useAssistantLevel();
  const { settings: voiceSettings } = useVoiceSettings();
  /** Speaks a verified on-screen result during a "Talk to Sanadi" call. */
  const liveSayRef = useRef<((text: string) => void) | null>(null);
  const [liveCallActive, setLiveCallActive] = useState(false);
  function addLiveVoiceTurn(spokenText: string, response: AgentResponse) {
    if (response.conversationId && response.conversationId !== conversationId) {
      setConversationId(response.conversationId);
      void navigate({ to: "/assistant", search: { chat: response.conversationId }, replace: true });
    }
    setMessages((prev) => [
      ...prev,
      ...(spokenText ? [{ role: "user" as const, content: `🎙 ${spokenText}` }] : []),
      {
        role: "assistant" as const,
        id: response.messageId ?? crypto.randomUUID(),
        content: response.answer ?? "",
        response,
        phase: "done" as const,
      },
    ]);
    void continuityQuery.refetch();
    void chatsQuery.refetch();
  }
  const [pendingAction, setPendingAction] = useState<ProposedAction | null>(null);
  /** Chat message the pending action button belongs to. */
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  /** Key of the action currently being submitted — its button shows "Submitting…". */
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  /** Actions completed in this session, merged with the server-stored ones. */
  const [localCompleted, setLocalCompleted] = useState<
    Record<string, { reference: string | null; actionType: string }>
  >({});
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  /** Plain-language stage shown while the current turn is being worked on. */
  const [stage, setStage] = useState<string | null>(null);
  /** Server-provided agent label for the current turn. Never derived client-side. */
  const [stageText, setStageText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** id of the assistant bubble currently receiving stream output. */
  const activeIdRef = useRef<string | null>(null);
  const lastSentRef = useRef<{ text: string; attachments: ChatAttachment[] } | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [busy]);

  const draftAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draftParam || draftAppliedRef.current === draftParam) return;
    draftAppliedRef.current = draftParam;
    setInput(draftParam);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [draftParam]);


  // A new message (typed, spoken or from a live call) always brings the latest
  // reply and its card into view. While a reply streams, only follow along if
  // the student is already at the bottom, so re-reading is never yanked away.
  const lastLenRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const isNew = messages.length > lastLenRef.current;
    lastLenRef.current = messages.length;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (!isNew && distance > 160) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, messages[messages.length - 1]?.content.length]);


  const casesQuery = useQuery({
    queryKey: ["cases", "active", user?.id],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cases")
        .select("id, case_number, title, status")
        .not("status", "in", "(resolved,closed)")
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data;
    },
  });

  const chatsQuery = useQuery({
    queryKey: ["my-chats", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => listMyChats(),
  });

  const briefingQuery = useQuery({
    queryKey: ["student-briefing", user?.id, lang],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    queryFn: () => getStudentBriefing({ data: { lang } }),
  });

  /** Updates the single in-flight assistant bubble, identified by its id. */
  function patchActive(update: (m: Extract<ChatMessage, { role: "assistant" }>) => ChatMessage) {
    const id = activeIdRef.current;
    if (!id) return;
    setMessages((prev) => {
      const index = prev.findIndex((m) => m.role === "assistant" && m.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = update(prev[index] as Extract<ChatMessage, { role: "assistant" }>);
      return next;
    });
  }

  /** Appends a real model token to the in-flight assistant bubble. */
  function appendDelta(delta: string) {
    setStreaming(true);
    patchActive((m) => ({ ...m, content: m.content + delta, phase: "streaming" }));
  }

  /**
   * The verification pass started. Keep every streamed character on screen —
   * blanking it here is what used to make the answer disappear and come back.
   */
  function markFinalizing() {
    patchActive((m) => ({ ...m, phase: "finalizing" }));
  }

  /** Commits the final verified response onto the streamed bubble, in place. */
  function commitAnswer(response: AgentResponse) {
    const full = response.answer ?? "";
    setStreaming(false);
    patchActive((m) => ({
      ...m,
      // Never fall back to an empty bubble: keep the streamed draft if the
      // final payload somehow carries no text.
      content: full.trim() ? full : m.content,
      response,
      phase: "done",
    }));
  }


  function startNewChat() {
    resumedRef.current = true;
    setConversationId(null);
    setMessages([]);
    setAttachments([]);
    void navigate({ to: "/assistant", search: {}, replace: true });
    inputRef.current?.focus();
  }

  async function openChat(id: string) {
    if (id === conversationId || loadingChatId) return;
    setLoadingChatId(id);
    try {
      const history = await getMyChatMessages({ data: { conversationId: id } });
      setConversationId(id);
      setMessages(
        history.map((m) =>
          m.role === "assistant"
            ? {
                role: "assistant" as const,
                content: m.content,
                id: m.messageId,
                phase: "done" as const,
                // Rebuilt from what was saved with the reply: sources, next
                // steps, receipt and the exact issued document.
                response: {
                  agent: "orchestrator",
                  classification: {} as AgentResponse["classification"],
                  answer: m.content,
                  verified: m.metadata?.verified ?? false,
                  citations: (m.metadata?.citations ?? []) as AgentResponse["citations"],
                  proposedActions: (m.metadata?.proposedActions ??
                    []) as AgentResponse["proposedActions"],
                  messageId: m.messageId,
                  conversationId: id,
                  responseType: (m.metadata?.responseType ??
                    "answer") as AgentResponse["responseType"],
                  intents: [],
                  clarifyingQuestion: null,
                  nextSteps: m.metadata?.nextSteps ?? [],
                  toolsUsed: m.metadata?.toolsUsed ?? [],
                  activity: m.metadata?.activity ?? [],
                  confidence: 1,
                  fallbackUsed: false,
                  humanHandoff: false,
                  receipt: (m.metadata?.receipt ?? null) as AgentResponse["receipt"],
                  issuedDocument: m.metadata?.issuedDocument ?? null,
                  careerInsight: m.metadata?.careerInsight ?? null,
                  libraryResults: m.metadata?.libraryResults ?? null,
                  caseResult: m.metadata?.caseResult ?? null,
                  followUp: null,
                } satisfies AgentResponse,
              }
            : { role: "user" as const, content: m.content, id: m.messageId },
        ),
      );
      setAttachments([]);
      setPendingAction(null);
    } catch {
      toast.error(t("error_generic"));
    } finally {
      setLoadingChatId(null);
    }
  }

  useEffect(() => {
    if (!chatParam || !user?.id) return;
    void openChat(chatParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatParam, user?.id]);

  // Reopening Sanadi — after a refresh, a new sign-in, a browser restart or on
  // a different device — continues the student's most recent conversation. The
  // conversation id is then kept in the address so the page can always be
  // restored from the server, never from browser memory.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !user?.id || chatParam || askParam || conversationId) return;
    resumedRef.current = true;
    void (async () => {
      try {
        const last = await getChatContinuityFn({ data: {} });
        if (last.conversationId) {
          void navigate({
            to: "/assistant",
            search: { chat: last.conversationId },
            replace: true,
          });
        }
      } catch {
        /* a blank chat is a safe fallback */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, chatParam, askParam]);

  // What this conversation was about, which request it belongs to, who is
  // handling it and anything still waiting on the student. Read from the
  // server every time the conversation is opened.
  const continuityQuery = useQuery({
    queryKey: ["chat-continuity", conversationId, user?.id],
    // Only while signed in: after sign-out (or before the session hydrates)
    // the call would reach the server without a bearer token and throw.
    enabled: Boolean(conversationId && user?.id),
    queryFn: () => getChatContinuityFn({ data: { conversationId } }),
    staleTime: 15_000,
  });

  // One-time actions already submitted in this conversation. Read from the
  // server so a refresh, a new sign-in or another device still shows them done.
  const completedActionsQuery = useQuery({
    queryKey: ["chat-completed-actions", conversationId, user?.id],
    enabled: Boolean(conversationId && user?.id),
    queryFn: () => listCompletedChatActionsFn({ data: { conversationId } }),
    staleTime: 5_000,
  });
  const completedActions = useMemo(() => {
    const map = new Map<string, { reference: string | null; actionType: string }>();
    for (const row of completedActionsQuery.data ?? []) {
      map.set(uiActionKey(row.messageId, row.actionKey), {
        reference: row.referenceNumber,
        actionType: row.actionType,
      });
    }
    for (const [key, value] of Object.entries(localCompleted)) map.set(key, value);
    return map;
  }, [completedActionsQuery.data, localCompleted]);

  const askedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!askParam || !user?.id || chatParam) return;
    if (askedRef.current === askParam) return;
    askedRef.current = askParam;
    void navigate({ to: "/assistant", search: {}, replace: true });
    void send(askParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askParam, user?.id, chatParam]);

  async function send(text: string, voice?: VoiceMeta): Promise<AgentResponse | null> {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || busy || uploading) return null;
    const sentAttachments = attachments;
    const body = trimmed || (lang === "ar" ? "أرفقت مستنداً." : "I have attached a document.");
    setInput("");
    setAttachments([]);
    lastSentRef.current = { text, attachments: sentAttachments };

    // One placeholder bubble per turn: created here, mutated in place until the
    // final verified answer lands. It is never removed or recreated.
    const turnId = crypto.randomUUID();
    activeIdRef.current = turnId;
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: sentAttachments.length
          ? `${body}\n\n📎 ${sentAttachments.map((a) => a.fileName).join(", ")}`
          : body,
      },
      { role: "assistant", id: turnId, content: "", phase: "streaming" },
    ]);
    setBusy(true);
    setStage(null);
    setStageText(null);
    try {
      const response = await streamAssistant(
        { message: body, conversationId, lang, attachments: sentAttachments, voice: voice ?? null },
        {
          onDelta: (delta) => {
            setBusy(false);
            appendDelta(delta);
          },
          onFinalizing: markFinalizing,
          onStage: (next, agent) => {
            setStage(next);
            setStageText(agent?.statusText ?? null);
          },
        },
      );
      setConversationId(response.conversationId ?? null);
      // Keep the conversation in the address bar so a refresh, a shared link or
      // a later sign-in reopens this exact conversation from the server.
      if (response.conversationId && response.conversationId !== chatParam) {
        void navigate({
          to: "/assistant",
          search: { chat: response.conversationId },
          replace: true,
        });
      }
      commitAnswer(response);
      if (!voice && voiceSettings.speakReplies && response.answer) {
        const spokenLang = detectSpokenLanguage(response.answer);
        void speakReply(
          `turn-${turnId}`,
          spokenSummary({ answer: response.answer, lang: spokenLang, hasPendingAction: (response.proposedActions ?? []).length > 0 }),
          spokenLang,
        ).catch(() => stopSpeaking());
      }
      void continuityQuery.refetch();
      void chatsQuery.refetch();
      void briefingQuery.refetch();
      return response;
    } catch {
      // Keep whatever was already streamed and mark the turn as interrupted so
      // the student can retry without losing the partial answer.
      patchActive((m) => ({ ...m, phase: "failed" }));
      toast.error(t("error_generic"));
      return null;
    } finally {
      activeIdRef.current = null;
      setBusy(false);
      setStreaming(false);
      setStage(null);
      setStageText(null);
    }
  }

  function retryLast() {
    const last = lastSentRef.current;
    if (!last || busy) return;
    setMessages((prev) => {
      const next = [...prev];
      // Drop the failed assistant bubble and its user message; send() re-adds both.
      if (next[next.length - 1]?.role === "assistant") next.pop();
      if (next[next.length - 1]?.role === "user") next.pop();
      return next;
    });
    setAttachments(last.attachments);
    void send(last.text);
  }


  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !user) return;
    setUploading(true);
    try {
      const uploaded: ChatAttachment[] = [];
      for (const file of Array.from(files).slice(0, 3)) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(t("attachment_too_large"));
          continue;
        }
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${user.id}/chat/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("case-evidence")
          .upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (error) {
          toastError(error, lang);
          continue;
        }
        uploaded.push({
          storagePath: path,
          fileName: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
        });
      }
      if (uploaded.length) {
        setAttachments((prev) => [...prev, ...uploaded].slice(0, 5));
        toast.success(t("attachment_ready"));
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      inputRef.current?.focus();
    }
  }

  // Avatar presence is tied to the real assistant lifecycle, not the typewriter alone.
  const avatarState =
    voiceState === "listening"
      ? "listening"
      : busy
        ? "thinking"
        : streaming
          ? "responding"
          : "idle";

  return (
    <div className="grid max-w-full gap-4 overflow-x-hidden lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <section className="flex h-[calc(100svh-9rem)] min-h-[24rem] min-w-0 flex-col rounded-2xl border bg-card card-shadow sm:h-auto sm:min-h-[60vh] lg:min-h-[70vh]">
        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-3 sm:p-5">
          {unitParam && unitQuery.isFetched ? (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
            >
              <span>
                {unitQuery.data
                  ? lang === "ar"
                    ? `أنت تسأل عن ${unitQuery.data.name_ar || unitQuery.data.name_en}.`
                    : `You're asking about ${unitQuery.data.name_en}.`
                  : lang === "ar"
                    ? "تعذّر العثور على هذه الوحدة."
                    : "That unit could not be found."}
              </span>
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => void navigateSearch({ search: (prev) => ({ ...prev, unit: undefined }) })}
              >
                {lang === "ar" ? "إزالة" : "Clear"}
              </button>
            </div>
          ) : null}
          {messages.length > 0 && continuityQuery.data ? (
            <ContinuityBanner continuity={continuityQuery.data} lang={lang} />
          ) : null}

          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-3 py-6 text-center sm:py-10">
              <SanadiAvatar className="mb-3 h-16 w-16 sm:h-20 sm:w-20" state={avatarState} level={voiceLevel} />
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("greeting")}</h1>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {briefingQuery.data?.headline ?? t("greeting_sub")}
              </p>

              {briefingQuery.isLoading ? (
                <div className="mt-4 flex justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                </div>
              ) : null}

              {briefingQuery.data?.facts.length ? (
                <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
                  {briefingQuery.data.facts.map((f) => (
                    <div
                      key={f.label}
                      className="rounded-full border bg-surface px-3 py-1 text-xs"
                    >
                      <span className="text-muted-foreground">{f.label}:</span>{" "}
                      <span className="font-medium">{f.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {messages.map((message, index) =>
            message.role === "user" ? (
              <div key={message.id ?? index} className="flex justify-end">
                <UserMessageBubble>{message.content}</UserMessageBubble>
              </div>
            ) : (
              <div key={message.id ?? index} className="group flex max-w-full gap-2 sm:max-w-[95%] sm:gap-3">
                <SanadiAvatar
                  className="hidden h-8 w-8 sm:block"
                  state={
                    message.phase === "streaming" || message.phase === "finalizing"
                      ? "responding"
                      : "idle"
                  }
                  animated={index === messages.length - 1}
                />
                <div className="min-w-0 flex-1 space-y-3">
                  {message.content ? (
                    <div className="overflow-x-auto rounded-2xl rounded-tl-sm border bg-surface/50 p-3 sm:p-4">
                      <AssistantMarkdown>{message.content}</AssistantMarkdown>
                      {message.phase === "streaming" || message.phase === "finalizing" ? (
                        <span
                          className="ms-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-primary/70"
                          aria-hidden
                        />
                      ) : null}
                    </div>
                  ) : (
                    <AssistantWorking
                      stage={index === messages.length - 1 ? stage : null}
                      statusText={index === messages.length - 1 ? stageText : null}
                      lang={lang}
                    />
                  )}

                  {message.phase === "failed" ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{tr(msgLang(message), "error_generic")}</span>
                      <Button size="sm" variant="outline" onClick={retryLast}>
                        {lang === "ar" ? "إعادة المحاولة" : "Retry"}
                      </Button>
                    </div>
                  ) : null}


                  {message.response ? (
                    <>
                      {(() => {
                        const kind = evidenceStatus({
                          verified: message.response.verified,
                          toolsUsed: message.response.toolsUsed,
                          citations: message.response.citations ?? [],
                          hasProposals: message.response.proposedActions.length > 0,
                        });
                        if (kind === "none") return null;
                        const label = EVIDENCE_LABEL[kind][msgLang(message)];
                        return kind === "unverified" ? (
                          <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning-foreground">
                            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            {label}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">{label}</p>
                        );
                      })()}

                      {message.response.classification.requiredUnitName ? (
                        <p className="text-xs text-muted-foreground">
                          {tr(msgLang(message), "routed_to")}: {message.response.classification.requiredUnitName}
                        </p>
                      ) : null}

                      {message.response.clarifyingQuestion ? (
                        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">
                          <p className="mb-1 font-medium">{tr(msgLang(message), "needs_more_info")}</p>
                          <p className="text-foreground">{message.response.clarifyingQuestion}</p>
                        </div>
                      ) : null}

                      {message.response.nextSteps.length &&
                      !/next steps|الخطوات التالية/i.test(message.content) ? (
                        <div className="rounded-xl border bg-card p-4 text-xs card-shadow">
                          <p className="mb-2 text-sm font-semibold">{tr(msgLang(message), "next_steps")}</p>
                          <ul className="list-disc space-y-1.5 ps-4 text-muted-foreground">
                            {message.response.nextSteps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <AssistantActivity
                        activity={message.response.activity ?? message.response.toolsUsed}
                        routedTo={message.response.classification.requiredUnitName ?? null}
                        lang={msgLang(message)}
                      />

                      {message.response.answer && message.phase !== "streaming" ? (
                        <ListenButton id={`turn-${message.id ?? index}`} text={message.response.answer} />
                      ) : null}

                      

                      {message.response.issuedDocument ? (
                        <IssuedDocumentCard document={message.response.issuedDocument} />
                      ) : null}

                      {message.response.careerInsight ? (
                        <CareerInsightCard
                          insight={message.response.careerInsight}
                          onAsk={(q) => void send(q)}
                        />
                      ) : null}

                      {message.response.libraryResults ? (
                        <LibraryResultsCard
                          card={message.response.libraryResults}
                          lang={msgLang(message)}
                          onAsk={(q) => void send(q)}
                        />
                      ) : null}

                      {message.response.caseResult ? (
                        <CaseResultCard
                          card={message.response.caseResult}
                          lang={msgLang(message)}
                          onDraft={(draft) => {
                            setInput(draft);
                            inputRef.current?.focus();
                          }}
                        />
                      ) : null}

                      {message.response.receipt ? (
                        <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-xs">
                          <p className="font-semibold text-success">{tr(msgLang(message), "action_recorded")}</p>
                          <p className="mt-1">
                            {tr(msgLang(message), "reference_number")}:{" "}
                            <span className="font-mono">
                              {message.response.receipt.referenceNumber ??
                                message.response.receipt.receiptNumber}
                            </span>
                          </p>
                          {message.response.receipt.expectedFirstResponseAt ? (
                            <p>
                              {tr(msgLang(message), "expected_first_response")}:{" "}
                              {new Date(
                                message.response.receipt.expectedFirstResponseAt,
                              ).toLocaleString()}
                            </p>
                          ) : null}
                          {message.response.receipt.liveStatus ? (
                            <p>
                              {lang === "ar" ? "الحالة الآن" : "Current status"}:{" "}
                              <span className="font-medium capitalize">
                                {message.response.receipt.liveStatus.replace(/_/g, " ")}
                              </span>
                              {message.response.receipt.assignedStaffName
                                ? ` · ${message.response.receipt.assignedStaffName}`
                                : ""}
                            </p>
                          ) : null}
                          {message.response.receipt.outcome ? (
                            <p>
                              {lang === "ar" ? "النتيجة" : "Outcome"}: {message.response.receipt.outcome}
                            </p>
                          ) : null}
                          <Link
                            to="/requests"
                            className="mt-2 inline-block font-medium text-primary hover:underline"
                          >
                            {tr(msgLang(message), "track_request")}
                          </Link>
                        </div>
                      ) : null}

                      {message.response.fallbackUsed ? (
                        <p className="text-xs text-muted-foreground">{tr(msgLang(message), "fallback_notice")}</p>
                      ) : null}

                      {message.response.humanHandoff ? (
                        <p className="text-xs text-warning-foreground">{tr(msgLang(message), "handoff_notice")}</p>
                      ) : null}

                      {message.response.proposedActions.length ? (
                        <div className="flex flex-wrap gap-2">
                          {message.response.proposedActions.map((action) => {
                            const key = uiActionKey(message.response?.messageId, action.key);
                            const done = completedActions.get(key) ?? ((action.toolName ?? action.key) === "book_hostel_room"
                              ? (completedActionsQuery.data ?? []).find(row => row.actionType === "book_hostel_room") && {
                                reference: (completedActionsQuery.data ?? []).find(row => row.actionType === "book_hostel_room")?.referenceNumber ?? null,
                                actionType: "book_hostel_room",
                              } : undefined);
                            const submitting = submittingKey === key;
                            const oneTime = isOneTimeAction(action.toolName ?? action.key);
                            if (done) {
                              return (
                                <Button key={action.key} size="sm" variant="secondary" disabled>
                                  {submittedLabel(done.actionType, lang)} ✓
                                  {done.reference
                                    ? ` · ${lang === "ar" ? "الرقم المرجعي" : "Reference"}: ${done.reference}`
                                    : ""}
                                </Button>
                              );
                            }
                            return (
                              <Button
                                key={action.key}
                                size="sm"
                                variant={action.risk === "level_0" ? "secondary" : "default"}
                                disabled={submitting || (oneTime && Boolean(submittingKey))}
                                onClick={() => {
                                  if (action.risk === "level_0" && action.route) {
                                    navigate({ to: action.route });
                                  } else {
                                    setPendingMessageId(message.response?.messageId ?? null);
                                    setPendingAction(action);
                                  }
                                }}
                              >
                                {submitting
                                  ? lang === "ar"
                                    ? "جارٍ الإرسال…"
                                    : "Submitting…"
                                  : lang === "ar"
                                    ? action.labelAr
                                    : action.labelEn}
                              </Button>
                            );
                          })}
                        </div>
                      ) : null}

                    </>
                  ) : null}
                </div>
              </div>
            ),
          )}

          {/* The thinking indicator lives inside the turn's own bubble, so the
              placeholder is never duplicated or swapped for another node. */}
          <div ref={endRef} />

        </div>

        <TalkToSanadi
          conversationId={conversationId}
          disabled={busy}
          onResponse={addLiveVoiceTurn}
          onActiveChange={setLiveCallActive}
          registerSay={(say) => {
            liveSayRef.current = say;
          }}
        />
        <form
          className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="rounded-2xl border bg-card p-2 card-shadow">
            {attachments.length ? (
              <div className="mb-1 flex flex-wrap gap-2 px-2 pt-2">
                {attachments.map((a) => (
                  <span
                    key={a.storagePath}
                    className="flex items-center gap-2 rounded-full border bg-surface px-2.5 py-1 text-xs"
                  >
                    <PaperclipIcon className="size-3" aria-hidden />
                    <span className="max-w-[140px] truncate sm:max-w-[180px]">{a.fileName}</span>
                    <button
                      type="button"
                      aria-label={lang === "ar" ? "إزالة المرفق" : "Remove attachment"}
                      onClick={() =>
                        setAttachments((prev) => prev.filter((p) => p.storagePath !== a.storagePath))
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              dir="auto"
              placeholder={t("assistant_placeholder")}
              rows={1}
              className="min-h-[44px] resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <div className="flex items-center gap-1 px-1 pb-1">
              <VoiceInput
                disabled={busy || liveCallActive}
                conversationId={conversationId}
                onTranscript={(text, autoSend, meta) => {
                  if (meta.confirmed) {
                    void send(input.trim() || text, meta);
                    return;
                  }
                  const merged = input.trim() && !input.trim().endsWith(text) ? `${input.trim()} ${text}` : text;
                  setInput(merged);
                  if (autoSend) {
                    void send(merged, meta);
                  } else {
                    inputRef.current?.focus();
                  }
                }}
              />
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.heic,.webp"
                className="hidden"
                onChange={(e) => void uploadFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("attach")}
                aria-label={t("attach")}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Paperclip className="size-4" aria-hidden />
                )}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="ms-auto gap-1.5"
                disabled={busy || uploading || (!input.trim() && attachments.length === 0)}
              >
                <Send className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t("send")}</span>
              </Button>
            </div>
          </div>
        </form>
      </section>

      <aside className="space-y-3">
        <div className="rounded-xl border bg-card p-3 card-shadow">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("chat_history")}
            </h2>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={startNewChat}>
              {t("new_chat")}
            </Button>
          </div>
          {chatsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("loading")}</p>
          ) : chatsQuery.data?.length ? (
            <ul className="space-y-1.5">
              {chatsQuery.data.map((chat) => (
                <li
                  key={chat.id}
                  className={`flex items-center gap-1 rounded-lg border p-1 text-xs ${
                    chat.id === conversationId ? "border-primary/40 bg-accent/30" : "bg-surface"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openChat(chat.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-accent/40"
                  >
                    {loadingChatId === chat.id ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">
                      {chat.title || t("untitled_chat")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("no_chats")}</p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-3 card-shadow">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("active_cases")}
            </h2>
            <Link to="/requests" className="text-xs text-primary hover:underline">
              {t("view_all")}
            </Link>
          </div>
          {casesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">{t("loading")}</p>
          ) : casesQuery.data?.length ? (
            <ul className="space-y-1.5">
              {casesQuery.data.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/requests/$caseId"
                    params={{ caseId: c.id }}
                    className="block rounded-lg border bg-surface p-2 text-xs hover:border-primary/40"
                  >
                    <span className="font-medium"><bdi dir="ltr">{c.case_number}</bdi></span>
                    <span className="ms-1 text-muted-foreground">{c.title}</span>
                    <span className="mt-1.5 block">
                      <StatusChip status={c.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("no_requests")}</p>
          )}
        </div>
      </aside>

      <ActionConfirmDialog
        action={pendingAction}
        open={Boolean(pendingAction)}
        conversationId={conversationId}
        messageId={pendingMessageId}
        onBusyChange={(busyNow) =>
          setSubmittingKey(
            busyNow && pendingAction ? uiActionKey(pendingMessageId, pendingAction.key) : null,
          )
        }
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirmed={(confirmedAction, result) => {
          // Immutable from this card once the backend confirmed the record.
          if (result.receipt && isOneTimeAction(confirmedAction.toolName ?? confirmedAction.key)) {
            setLocalCompleted((prev) => ({
              ...prev,
              [uiActionKey(pendingMessageId, confirmedAction.key)]: {
                reference:
                  result.receipt?.referenceNumber ?? result.receipt?.receiptNumber ?? null,
                actionType: confirmedAction.toolName ?? confirmedAction.key,
              },
            }));
            void completedActionsQuery.refetch();
          }
          liveSayRef.current?.(result.message);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: result.message,
              response: {
                agent: "action",
                classification: {
                  intent: "unknown",
                  category: "action",
                  language: lang,
                  urgency: "low",
                  sentiment: "neutral",
                  requiredUnitCode: null,
                  requiredUnitName: result.receipt?.responsibleUnit ?? null,
                  requiresAuth: true,
                  requiresStudentData: false,
                  actionRequested: true,
                  requiresHumanEscalation: false,
                  confidence: 1,
                },
                answer: result.message,
                verified: true,
                citations: [],
                proposedActions: [],
                messageId: null,
                conversationId,
                responseType: "receipt",
                intents: [],
                clarifyingQuestion: null,
                nextSteps: result.receipt?.nextStep ? [result.receipt.nextStep] : [],
                toolsUsed: [],
                confidence: 1,
                fallbackUsed: false,
                humanHandoff: false,
                receipt: result.receipt,
                issuedDocument: result.document ?? null,
                followUp: null,
              },
            },
          ]);
        }}
      />
    </div>
  );
}

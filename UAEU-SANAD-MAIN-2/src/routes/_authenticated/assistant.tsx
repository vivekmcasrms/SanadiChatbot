import { AssistantWorking } from "@/components/AssistantProgress";
import { AssistantActivity } from "@/components/AssistantActivity";
import { toastError } from "@/lib/errors/toast";
import { useEffect, useMemo, useRef, useState } from "react";
import { listCompletedChatActionsFn } from "@/lib/chat-actions.functions";
import { isOneTimeAction, submittedLabel, uiActionKey } from "@/lib/agent/one-time-actions";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Paperclip,
  Paperclip as PaperclipIcon,
  Send,
  ShieldAlert,
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
import { listAllMyActiveCases } from "@/lib/lists/student-lists.functions";
import { refreshStudentRecords } from "@/lib/student-records-cache";
import { ListError } from "@/components/list/ListControls";
import { getChatContinuityFn } from "@/lib/chat-continuity.functions";
import { ContinuityBanner } from "@/components/ContinuityBanner";
import { getStudentBriefing } from "@/lib/student-briefing.functions";
import { VoiceChatMic, VoiceChatStatusBar, type VoiceChatMicControl, type VoiceChatActivity } from "@/components/VoiceChatMic";
import { useVoiceSettings } from "@/lib/voice-settings";
import { VoiceReplyPresentation } from "@/lib/voice-reply-presentation";
import {
  voiceTranscriptLanguage,
} from "@/lib/voice-channel";
import { BrowserSpeech, browserSpeechError } from "@/lib/browser-speech";
import { forSpeakingHighlights } from "@/lib/voice-agent";

export const Route = createFileRoute("/_authenticated/assistant")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { chat?: string | undefined; ask?: string | undefined; draft?: string | undefined } => ({
    chat: typeof search["chat"] === "string" ? (search["chat"] as string) : undefined,
    ask: typeof search["ask"] === "string" ? (search["ask"] as string) : undefined,
    draft: typeof search["draft"] === "string" ? (search["draft"] as string) : undefined,
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

function SupportAgentIcon({
  agent,
  className = "",
}: {
  agent: "mira" | "suhail";
  className?: string;
}) {
  const isMira = agent === "mira";
  const portrait = isMira ? "/mira-support-agent.png" : "/suhail-support-agent.png";
  return (
    <span
      role="img"
      aria-label={isMira ? "Mira, female support agent" : "Suhail, male support agent"}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border shadow-sm ${isMira ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200" : "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200"} ${className}`}
    >
      <img src={portrait} alt="" className="size-full rounded-full object-cover" />
    </span>
  );
}

function AssistantPage() {
  const queryClient = useQueryClient();
  const { t, lang } = useI18n();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { chat: chatParam, ask: askParam, draft: draftParam } = Route.useSearch();
  const { settings: voiceSettings } = useVoiceSettings();
  const [input, setInput] = useState("");
  const [voiceActivity, setVoiceActivity] = useState<VoiceChatActivity | null>(null);
  const [voiceTranscriptPreview, setVoiceTranscriptPreview] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState<"en" | "ar">(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem("sanadi-voice-language") === "ar" ? "ar" : "en"; }
    catch { return "en"; }
  });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [supportAgent, setSupportAgent] = useState<"mira" | "suhail">(() =>
    typeof window !== "undefined" && window.localStorage.getItem("sanadi-support-agent") === "suhail"
      ? "suhail"
      : "mira",
  );
  const voiceMicRef = useRef<VoiceChatMicControl>(null);
  const readAloudRef = useRef(new BrowserSpeech());
  const readAloudAbortRef = useRef<AbortController | null>(null);
  function stopReadAloud() {
    readAloudAbortRef.current?.abort();
    readAloudAbortRef.current = null;
  }
  useEffect(() => () => stopReadAloud(), [supportAgent, conversationId]);
  const voiceBubbleRef = useRef<{ id: string; finalized: boolean; presentation: VoiceReplyPresentation<AgentResponse> } | null>(null);
  const [busy, setBusy] = useState(false);
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
  useEffect(() => {
    if (voiceTranscriptPreview && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [voiceTranscriptPreview]);
  /** id of the assistant bubble currently receiving stream output. */
  const activeIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<{ text: string; attachments: ChatAttachment[]; supportAgent: "mira" | "suhail" } | null>(null);

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


  // Short replies: pin to bottom. Lengthy replies: one-shot scroll to the
  // question + 20% of the response height, then stop so the question stays visible.
  const longScrollTurnRef = useRef<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const last = messages[messages.length - 1];
    const text = last?.role === "assistant" ? (last.content ?? "") : "";
    const lineCount = text
      .split(/\r?\n/)
      .reduce((sum, row) => sum + Math.max(1, Math.ceil(row.length / 90)), 0);

    const answerEl = () => el.querySelector<HTMLElement>("[data-chat-turn=answer]");
    const questionEl = () => el.querySelector<HTMLElement>("[data-chat-turn=question]");

    const isLengthy = () => {
      if (last?.role !== "assistant") return false;
      const height = answerEl()?.offsetHeight ?? 0;
      // Text lines OR tall rendered cards (academic snapshot, tables, etc.)
      return lineCount >= 10 || height >= Math.min(280, el.clientHeight * 0.45);
    };

    const pinBottom = () => {
      el.scrollTop = el.scrollHeight;
    };

    const pinPartial = () => {
      const question = questionEl();
      const answer = answerEl();
      if (!question) return false;
      const gap = 16; // small gap between question and the chat panel top edge
      const parentTop = el.getBoundingClientRect().top;
      const qTop = question.getBoundingClientRect().top - parentTop + el.scrollTop;
      const responseHeight = answer?.offsetHeight ?? 0;
      // Scroll 20% into the response…
      el.scrollTop = Math.max(0, qTop - gap + responseHeight * 0.2);
      // …then pull back if that pushed the question too close to the top border.
      const qVisibleTop = question.getBoundingClientRect().top - el.getBoundingClientRect().top;
      if (qVisibleTop < gap) {
        const corrected =
          question.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
        el.scrollTop = Math.max(0, corrected - gap);
      }
      return true;
    };

    if (last?.role === "assistant" && isLengthy()) {
      const turnId = last.id ?? `idx-${messages.length - 1}`;
      if (longScrollTurnRef.current === turnId) return;

      const apply = () => {
        if (pinPartial()) longScrollTurnRef.current = turnId;
      };
      apply();
      const frame = requestAnimationFrame(apply);
      const timeout = window.setTimeout(apply, 80);
      return () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(timeout);
      };
    }

    // Still short — follow the bottom. Clear any prior long-turn lock.
    if (last?.role !== "assistant") longScrollTurnRef.current = null;
    else if (!isLengthy()) longScrollTurnRef.current = null;

    pinBottom();
    const frame = requestAnimationFrame(() => {
      pinBottom();
      requestAnimationFrame(pinBottom);
    });
    const timeout = window.setTimeout(pinBottom, 50);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [messages.length, busy, streaming, messages[messages.length - 1]?.content, messages[messages.length - 1]?.phase]);

  // Late layout growth: never pin to bottom once the reply is lengthy.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const pin = () => {
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        const text = last.content ?? "";
        const lineCount = text
          .split(/\r?\n/)
          .reduce((sum, row) => sum + Math.max(1, Math.ceil(row.length / 90)), 0);
        const answer = el.querySelector<HTMLElement>("[data-chat-turn=answer]");
        const height = answer?.offsetHeight ?? 0;
        if (lineCount >= 10 || height >= Math.min(280, el.clientHeight * 0.45)) return;
      }
      el.scrollTop = el.scrollHeight;
    };

    const ro = new ResizeObserver(pin);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [busy, streaming, messages.length, messages[messages.length - 1]?.content]);


  const casesQuery = useQuery({
    queryKey: ["cases", "active", user?.id],
    enabled: Boolean(user?.id),
    queryFn: listAllMyActiveCases,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const chatsQuery = useQuery({
    queryKey: ["my-chats", user?.id],
    enabled: Boolean(user?.id),
    queryFn: () => listMyChats(),
    staleTime: 0,
    refetchOnMount: "always",
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
    patchActive((m) => {
      return {
        ...m,
        content: full.trim() ? full : m.content,
        response,
        phase: "done",
      };
    });
  }


  function startNewChat() {
    voiceMicRef.current?.reset();
    voiceBubbleRef.current = null;
    resumedRef.current = true;
    setConversationId(null);
    setMessages([]);
    setAttachments([]);
    void navigate({ to: "/assistant", search: {}, replace: true });
    inputRef.current?.focus();
  }

  async function openChat(id: string) {
    if (id === conversationId || loadingChatId) return;
    voiceMicRef.current?.reset();
    voiceBubbleRef.current = null;
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
            : {
                role: "user" as const,
                content: m.content.endsWith(CONCISE_RESPONSE_GUIDANCE)
                  ? m.content.slice(0, -CONCISE_RESPONSE_GUIDANCE.length)
                  : m.content,
                id: m.messageId,
              },
        ),
      );
      setAttachments([]);
      setPendingAction(null);
    } catch {
      // A bookmarked/recent conversation can become unavailable (for example
      // after it was removed, or while the API is recovering). Loading the
      // assistant must still succeed: discard only that failed restoration,
      // remove its stale URL parameter, and stay on a clean new chat. Mark the
      // continuity attempt as handled so it cannot immediately reopen the same
      // unavailable conversation and repeat the failure.
      resumedRef.current = true;
      setConversationId(null);
      setMessages([]);
      setAttachments([]);
      setPendingAction(null);
      void navigate({ to: "/assistant", search: {}, replace: true });
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

  async function send(
    text: string,
    selectedAgent = supportAgent,
    includeComposerAttachments = true,
    languageOverride?: "en" | "ar",
  ): Promise<AgentResponse | null> {
    const trimmed = text.trim();
    const composerAttachments = includeComposerAttachments ? attachments : [];
    if ((!trimmed && composerAttachments.length === 0) || busyRef.current || uploading) return null;
    voiceMicRef.current?.stop();
    busyRef.current = true;
    const requestController = new AbortController();
    requestControllerRef.current = requestController;
    const sentAttachments = composerAttachments;
    // Reply language follows what the student typed/spoke — not the UI locale.
    const responseLang =
      languageOverride ??
      (trimmed ? voiceTranscriptLanguage(trimmed, lang === "ar" ? "ar" : "en") : lang === "ar" ? "ar" : "en");
    const body = trimmed || (responseLang === "ar" ? "أرفقت مستنداً." : "I have attached a document.");
    setInput("");
    setVoiceActivity(null);
    if (includeComposerAttachments) setAttachments([]);
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
        { message: body, conversationId, lang: responseLang, attachments: sentAttachments, supportAgent: selectedAgent },
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
        requestController.signal,
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
      void continuityQuery.refetch();
      void refreshStudentRecords(queryClient, user?.id);
      void briefingQuery.refetch();
      return response;
    } catch (cause) {
      // Keep whatever was already streamed and mark the turn as interrupted so
      // the student can retry without losing the partial answer.
      if ((cause as DOMException)?.name === "AbortError") {
        patchActive((m) => ({ ...m, phase: "done" }));
      } else {
        patchActive((m) => ({ ...m, phase: "failed" }));
        toast.error(t("error_generic"));
      }
      return null;
    } finally {
      if (requestControllerRef.current === requestController) requestControllerRef.current = null;
      activeIdRef.current = null;
      setBusy(false);
      setStreaming(false);
      setStage(null);
      setStageText(null);
      busyRef.current = false;
    }
  }

  async function speakAnswer(text: string, language: "en" | "ar") {
    if (typeof window === "undefined") return;
    stopReadAloud();
    voiceMicRef.current?.stop();
    // Prefer the script of the answer itself — UI locale must not drive TTS.
    const replyLang = voiceTranscriptLanguage(text, language);
    const spoken = forSpeakingHighlights(text, replyLang);
    if (!spoken) return;
    const controller = new AbortController();
    readAloudAbortRef.current = controller;
    try {
      await readAloudRef.current.speak(spoken, replyLang, supportAgent, controller.signal, () => {});
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== "AbortError")
        toast.error(browserSpeechError(error, lang) ?? t("error_generic"));
    } finally {
      if (readAloudAbortRef.current === controller) readAloudAbortRef.current = null;
    }
  }

  function onVoiceTranscript(text: string) {
    setVoiceTranscriptPreview("");
    setStage(null);
    setStageText(null);
    const id = crypto.randomUUID();
    voiceBubbleRef.current = { id, finalized: false, presentation: new VoiceReplyPresentation(response => {
      const turn = voiceBubbleRef.current;
      if (!turn || turn.id !== id) return;
      turn.finalized = true;
      setMessages(previous => previous.map(message => message.role === "assistant" && message.id === id
        ? { ...message, content: response.answer, response, phase: "done" } : message));
    }) };
    setMessages(previous => [...previous,
      { role: "user", content: text },
      { role: "assistant", id, content: "", phase: "streaming" },
    ]);
  }

  function onVoiceSpeech(text: string) {
    const turn = voiceBubbleRef.current;
    turn?.presentation.start();
    if (!turn || turn.finalized) return;
    setMessages(previous => previous.map(message => message.role === "assistant" && message.id === turn.id
      ? { ...message, content: `${message.content} ${text}`.trim() } : message));
  }

  function onVoiceResult(response: AgentResponse) {
    const turn = voiceBubbleRef.current;
    if (!turn) return;
    turn.presentation.result(response);
    setConversationId(response.conversationId);
    if (response.conversationId && response.conversationId !== chatParam)
      void navigate({ to: "/assistant", search: { chat: response.conversationId }, replace: true });
    void chatsQuery.refetch();
    void continuityQuery.refetch();
    void refreshStudentRecords(queryClient, user?.id);
    void briefingQuery.refetch();
  }

  function onVoiceEnd() {
    setVoiceTranscriptPreview("");
    const turn = voiceBubbleRef.current;
    turn?.presentation.finish();
    voiceBubbleRef.current = null;
    if (!turn) return;
    setStage(null);
    setStageText(null);
    if (turn.finalized) return;
    setMessages(previous => previous
      .filter(message => message.role !== "assistant" || message.id !== turn.id || Boolean(message.content))
      .map(message => message.role === "assistant" && message.id === turn.id ? { ...message, phase: "done" } : message));
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
    void send(last.text, last.supportAgent);
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

  return (
    <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
      <section className="flex h-[calc(100dvh-8rem)] max-h-[calc(100dvh-8rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border bg-card card-shadow lg:h-[calc(100dvh-10.5rem)] lg:max-h-[calc(100dvh-10.5rem)] lg:min-h-[24rem]">
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3 sm:p-5 [scrollbar-width:thin] [scrollbar-color:hsl(var(--border)/0.55)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/50 hover:[&::-webkit-scrollbar-thumb]:bg-border/70"
        >
          {messages.length > 0 && continuityQuery.data ? (
            <ContinuityBanner continuity={continuityQuery.data} lang={lang} />
          ) : null}

          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-3 py-6 text-center sm:py-10">
              <SupportAgentIcon agent={supportAgent} className="mb-3 size-16 sm:size-20" />
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

          {(() => {
            const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
            return messages.map((message, index) => {
            const isLatestQuestion = message.role === "user" && index === lastUserIdx;
            const isLatestAnswer = message.role === "assistant" && index === messages.length - 1;
            return message.role === "user" ? (
              <div
                key={message.id ?? index}
                className="flex justify-end"
                {...(isLatestQuestion ? { "data-chat-turn": "question" } : {})}
              >
                <UserMessageBubble>{message.content}</UserMessageBubble>
              </div>
            ) : (
              <div
                key={message.id ?? index}
                className="group flex max-w-full gap-2 sm:max-w-[95%] sm:gap-3"
                {...(isLatestAnswer ? { "data-chat-turn": "answer" } : {})}
              >
                <SupportAgentIcon agent={supportAgent} className="hidden size-10 sm:inline-flex" />
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
                      <span>{t("error_generic")}</span>
                      <Button size="sm" variant="outline" onClick={retryLast}>
                        {lang === "ar" ? "إعادة المحاولة" : "Retry"}
                      </Button>
                    </div>
                  ) : null}


                  {message.response ? (
                    <>
                      {message.response.verified || message.response.proposedActions.length ? null : (
                        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-warning-foreground">
                          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {t("unverified_notice")}
                        </p>
                      )}

                      {message.response.classification.requiredUnitName ? (
                        <p className="text-xs text-muted-foreground">
                          {t("routed_to")}: {message.response.classification.requiredUnitName}
                        </p>
                      ) : null}

                      {message.response.clarifyingQuestion &&
                      message.response.clarifyingQuestion.trim() !== message.content.trim() ? (
                        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">
                          <p className="mb-1 font-medium">{t("needs_more_info")}</p>
                          <p className="text-foreground">{message.response.clarifyingQuestion}</p>
                        </div>
                      ) : null}

                      {message.response.nextSteps.length &&
                      !/next steps|الخطوات التالية/i.test(message.content) ? (
                        <div className="rounded-xl border bg-card p-4 text-xs card-shadow">
                          <p className="mb-2 text-sm font-semibold">{t("next_steps")}</p>
                          <ul className="list-disc space-y-1.5 ps-4 text-muted-foreground">
                            {message.response.nextSteps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <AssistantActivity
                        activity={[
                          ...(message.response.toolsUsed ?? []),
                          ...(message.response.activity ?? []),
                        ]}
                        routedTo={message.response.classification.requiredUnitName ?? null}
                        lang={lang}
                      />

                      {message.response.citations.length > 0 ? (
                        <section aria-label={lang === "ar" ? "المصادر" : "Sources"} className="rounded-xl border bg-card p-3 text-xs">
                          <p className="mb-2 font-semibold">{lang === "ar" ? "المصادر" : "Sources"}</p>
                          <ul className="space-y-1 text-muted-foreground">
                            {message.response.citations.filter((citation, i, all) =>
                              all.findIndex((other) => other.documentId === citation.documentId
                                && other.sourceTitle === citation.sourceTitle
                                && other.documentVersion === citation.documentVersion) === i,
                            ).map((citation, i) => (
                              <li key={`${citation.documentId ?? citation.sourceTitle}-${i}`}>
                                {citation.citationUrl && /^(https?:\/\/|\/(?!\/))/i.test(citation.citationUrl) ? (
                                  <a href={citation.citationUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                                    {citation.sourceTitle}
                                  </a>
                                ) : citation.sourceTitle}
                                {citation.documentVersion ? ` · v${citation.documentVersion}` : ""}
                                {citation.owningUnit ? ` · ${citation.owningUnit}` : ""}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : null}

                      {message.response.toolsUsed.some(
                        (tool) => tool && tool !== "none" && tool !== "greeting" && tool !== "get_proactive_service",
                      ) ? (
                        <p className="text-xs text-muted-foreground">
                          {message.response.toolsUsed.includes("search_knowledge_base")
                            ? (lang === "ar" ? "تم التحقق من الإجابة من مصادر الجامعة المعتمدة." : "Checked against approved university sources.")
                            : (lang === "ar" ? "تم التحقق من هذه الإجابة مقابل سجلاتك الرسمية في الجامعة." : "Checked against your official university records.")}
                        </p>
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
                          lang={lang}
                          onAsk={(q) => void send(q)}
                        />
                      ) : null}

                      {message.response.caseResult ? (
                        <CaseResultCard
                          card={message.response.caseResult}
                          lang={lang}
                          onDraft={(draft) => {
                            setInput(draft);
                            inputRef.current?.focus();
                          }}
                        />
                      ) : null}

                      {message.response.receipt ? (
                        <div className="rounded-xl border border-success/40 bg-success/5 p-4 text-xs">
                          <p className="font-semibold text-success">{t("action_recorded")}</p>
                          <p className="mt-1">
                            {t("reference_number")}:{" "}
                            <span className="font-mono">
                              {message.response.receipt.referenceNumber ??
                                message.response.receipt.receiptNumber}
                            </span>
                          </p>
                          {message.response.receipt.expectedFirstResponseAt ? (
                            <p>
                              {t("expected_first_response")}:{" "}
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
                            to={
                              message.response.receipt.trackingUrl === "/documents"
                                ? "/documents"
                                : "/requests"
                            }
                            className="mt-2 inline-block font-medium text-primary hover:underline"
                          >
                            {message.response.receipt.trackingUrl === "/documents"
                              ? lang === "ar"
                                ? "عرض في وثائقي"
                                : "View in My Documents"
                              : t("track_request")}
                          </Link>
                        </div>
                      ) : null}

                      {message.response.fallbackUsed ? (
                        <p className="text-xs text-muted-foreground">{t("fallback_notice")}</p>
                      ) : null}

                      {message.response.humanHandoff ? (
                        <p className="text-xs text-warning-foreground">{t("handoff_notice")}</p>
                      ) : null}

                      {message.response.proposedActions.length ? (
                        <div className="flex flex-wrap gap-2">
                          {message.response.proposedActions.map((action) => {
                            const key = uiActionKey(message.response?.messageId, action.key);
                            const done = completedActions.get(key);
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
            );
          });
          })()}

          {voiceTranscriptPreview ? <div className="flex justify-end" aria-label={lang === "ar" ? "سؤالك الصوتي" : "Your spoken question"}>
            <UserMessageBubble><span dir="auto">{voiceTranscriptPreview}</span></UserMessageBubble>
          </div> : null}

          {/* The thinking indicator lives inside the turn's own bubble, so the
              placeholder is never duplicated or swapped for another node. */}
          <div ref={endRef} />

        </div>

        <form
          className="min-w-0 shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="mb-2 grid min-w-0">
          <div aria-hidden={voiceActivity ? true : undefined} inert={Boolean(voiceActivity)}
            className={`col-start-1 row-start-1 flex flex-wrap items-center gap-2 px-1 ${voiceActivity ? "invisible pointer-events-none" : ""}`}>
            {voiceSettings.enabled ? (
              <VoiceChatMic ref={voiceMicRef} agent={supportAgent} language={voiceLanguage} conversationId={conversationId}
                disabled={busy || streaming || uploading || Boolean(loadingChatId)}
                onTranscript={onVoiceTranscript} onSpeech={onVoiceSpeech} onResult={onVoiceResult}
                onTranscriptPreview={setVoiceTranscriptPreview}
                onActivity={activity => {
                  if (activity) stopReadAloud();
                  setVoiceActivity(activity);
                }} onEnd={onVoiceEnd} />
            ) : null}
            <div className="inline-flex items-center gap-1 rounded-full border bg-card p-1" role="group" aria-label={lang === "ar" ? "اختر المساعد" : "Choose assistant"}>
              <button
                type="button"
                aria-pressed={supportAgent === "mira"}
                onClick={() => {
                  setSupportAgent("mira");
                  window.localStorage.setItem("sanadi-support-agent", "mira");
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${supportAgent === "mira" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <img src="/mira-support-agent.png" alt="" className="size-7 rounded-full object-cover" />
                Mira
              </button>
              <button
                type="button"
                aria-pressed={supportAgent === "suhail"}
                onClick={() => {
                  setSupportAgent("suhail");
                  window.localStorage.setItem("sanadi-support-agent", "suhail");
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${supportAgent === "suhail" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <img src="/suhail-support-agent.png" alt="" className="size-7 rounded-full object-cover" />
                Suhail
              </button>
            </div>
            {voiceSettings.enabled ? <div dir="ltr" role="group" aria-label={lang === "ar" ? "لغة المحادثة الصوتية" : "Voice language"}
              className="inline-flex items-center gap-1 rounded-full border bg-card p-1">
              {(["en", "ar"] as const).map(language => <button key={language} type="button"
                aria-pressed={voiceLanguage === language} title={language === "en" ? "English" : "العربية"}
                onClick={() => {
                  setVoiceLanguage(language);
                  try { window.localStorage.setItem("sanadi-voice-language", language); } catch { /* Selection still works without storage. */ }
                }}
                className={`rounded-full px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${voiceLanguage === language ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {language}
              </button>)}
            </div> : null}
          </div>
          {voiceActivity ? <div className="relative z-10 col-start-1 row-start-1 min-w-0">
            <VoiceChatStatusBar agent={supportAgent} activity={voiceActivity}
              onInterrupt={() => voiceMicRef.current?.interrupt()}
              onMute={() => voiceMicRef.current?.toggleMute()} onEnd={() => voiceMicRef.current?.stop()} />
          </div> : null}
          </div>
          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {attachments.map((a) => (
                <span
                  key={a.storagePath}
                  className="flex items-center gap-2 rounded-full border bg-surface px-2.5 py-1 text-xs"
                >
                  <PaperclipIcon className="size-3" aria-hidden />
                  <span className="max-w-[140px] truncate sm:max-w-[180px]">{a.fileName}</span>
                  <button
                    type="button"
                    aria-label="Remove attachment"
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
          <div className="flex w-full min-w-0 items-center overflow-hidden rounded-full bg-card ps-1.5 card-shadow">
            <div className="flex shrink-0 items-center gap-0.5 pe-1.5">
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
                className="size-10 shrink-0 text-muted-foreground"
              >
                {uploading ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                ) : (
                  <Paperclip className="size-5" aria-hidden />
                )}
              </Button>
            </div>
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              dir="auto"
              placeholder={t("assistant_placeholder")}
              rows={1}
              className="composer-input min-h-[44px] max-h-32 w-0 min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <Button
              type="submit"
              size="sm"
              className="h-11 shrink-0 gap-1.5 rounded-none rounded-e-full px-4"
              disabled={busy || uploading || (!input.trim() && attachments.length === 0)}
            >
              <Send className="size-4" aria-hidden />
              <span>{t("send")}</span>
            </Button>
          </div>
        </form>
      </section>

      <aside className="flex min-w-0 flex-col gap-3 lg:h-[calc(100dvh-10.5rem)] lg:max-h-[calc(100dvh-10.5rem)] lg:min-h-[24rem]">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card p-3 card-shadow">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("chat_history")}
            </h2>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={startNewChat}>
              {t("new_chat")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:hsl(var(--border)/0.55)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/50 hover:[&::-webkit-scrollbar-thumb]:bg-border/70">
            {chatsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">{t("loading")}</p>
            ) : chatsQuery.isError ? (
              <ListError onRetry={() => void chatsQuery.refetch()} />
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
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card p-3 card-shadow">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("active_cases")}
            </h2>
            <Link to="/requests" className="text-xs text-primary hover:underline">
              {t("view_all")}
            </Link>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:hsl(var(--border)/0.55)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/50 hover:[&::-webkit-scrollbar-thumb]:bg-border/70">
            {casesQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">{t("loading")}</p>
            ) : casesQuery.isError ? (
              <ListError onRetry={() => void casesQuery.refetch()} />
            ) : casesQuery.data?.length ? (
              <ul className="space-y-1.5">
                {casesQuery.data.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/requests/$caseId"
                      params={{ caseId: c.id }}
                      className="block rounded-lg border bg-surface p-2 text-xs hover:border-primary/40"
                    >
                      <span className="font-medium">{c.case_number}</span>
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
          void refreshStudentRecords(queryClient, user?.id);
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

import { getActiveRoles } from "@/lib/authz/roles.server";
import { voiceStyleBlock } from "@/lib/arabic/emirati";
import { voiceArabicStyleNow } from "@/lib/agent/settings.server";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AgentResponse } from "@/lib/agent-types";
import { spokenSummary } from "@/lib/voice/spoken-summary";
import { detectSpokenLanguage } from "@/lib/voice/normalize";

type ModelMessage = { role: "user" | "assistant"; content: string };
type SanadiPayload = { response: AgentResponse };
/** The verified student this call runs as. Every backend step uses it. */
type Student = { db: unknown; userId: string; roles: string[]; conversationId: string | null; lang: "en" | "ar"; persona: "meera" | "suhail" };

export type LiveConfig = {
  baseURL: string;
  key: string;
  liveModel: string;
  backendModel: string;
  openingInstructions?: string;
};

// Fill from co-loaded knowledge: the gateway URL, the Live model and the resolved chat model.
// Backend reasoning is Sanadi's own assistant (runAgentTurn), not a separate model call.
const liveSettings = {
  baseURL: "https://ai.gateway.lovable.dev",
  liveModel: "openai/gpt-live-1",
  backendModel: "sanadi-orchestrator",
};

export type LiveSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: unknown) => void): void;
  onClose(handler: () => void): void;
  onError(handler: () => void): void;
};

export type LiveExecutionContext = { waitUntil(task: Promise<unknown>): void };
export type LiveConnector = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<LiveSocket>;

type WorkerSocket = WebSocket & { accept(): void };
declare const WebSocketPair: { new (): { 0: WorkerSocket; 1: WorkerSocket } };
type Transcript = {
  role: "user" | "assistant";
  text: string;
  start_ms: number;
  end_ms: number;
  listeningSound: boolean;
};
type ProviderEvent = {
  type: string;
  client_event_id?: string;
  error?: { client_event_id?: string; message?: string };
  session?: { id: string };
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  delegation?: { id: string; target: string };
};

export function getLiveConfig(): LiveConfig {
  const config: LiveConfig = {
    ...liveSettings,
    openingInstructions:
      "Greet the student briefly, introducing yourself by your persona name from Sanadi, UAEU student services: one short line in English, then the same in Arabic. Ask how you can help, then listen.",
    key: process.env["LOVABLE_API_KEY"] ?? "",
  };
  if ([config.baseURL, config.key, config.liveModel, config.backendModel].some((value) => !value)) {
    throw new Error("Missing Live relay configuration");
  }
  return config;
}

function gatewayAPIBase(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
}

async function gatewayRejection(response: Response) {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.slice(0, 300) : "";
  return new Error(message || `Voice gateway rejected the connection (${response.status})`);
}

export function validateLiveUpgrade(request: Request, options: { allowMissingOrigin?: boolean } = {}): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null ? !options.allowMissingOrigin : origin !== new URL(request.url).origin) {
    return new Response("Voice connection origin rejected", { status: 403 });
  }
  if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("WebSocket required", { status: 426 });
  }
  return null;
}

function workerSocket(socket: WorkerSocket): LiveSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    onMessage: (handler) => socket.addEventListener("message", (event) => handler(event.data)),
    onClose: (handler) => socket.addEventListener("close", handler),
    onError: (handler) => socket.addEventListener("error", handler),
  };
}

export function handleLiveRequest(request: Request): Response {
  const waitUntil = (request as Request & Partial<LiveExecutionContext>).waitUntil;
  if (!waitUntil) return new Response("Live runtime unavailable", { status: 503 });
  const config = getLiveConfig();
  const rejected = validateLiveUpgrade(request);
  if (rejected) return rejected;
  const pair = new WebSocketPair();
  pair[1].accept();
  bindLiveConnection(workerSocket(pair[1]), config, { waitUntil }, async (url, headers, signal) => {
    const response = await fetch(url, { headers: { ...headers, Upgrade: "websocket" }, signal });
    const socket = (response as Response & { webSocket?: WorkerSocket | null }).webSocket;
    if (!socket) throw await gatewayRejection(response);
    socket.accept();
    return workerSocket(socket);
  });
  const response: ResponseInit & { webSocket: WebSocket } = { status: 101, webSocket: pair[0] };
  return new Response(null, response);
}

/** The student's chosen voice: Meera (female) or Suhail (male). */
const PERSONAS = {
  meera: { voice: "marin", name: "Meera", nameAr: "ميرا", gender: "female" },
  suhail: { voice: "meridian", name: "Suhail", nameAr: "سهيل", gender: "male" },
} as const;

function personaInstructions(persona: "meera" | "suhail") {
  const p = PERSONAS[persona];
  return `\nVoice persona: your name is ${p.name} (${p.nameAr} in Arabic), a ${p.gender} voice of Sanadi. Introduce yourself as ${p.name} from Sanadi and use ${p.gender === "female" ? "feminine" : "masculine"} self-references in Arabic.`;
}

const conversationInstructions = `You are Sanadi, the bilingual student-services assistant of United Arab Emirates University (UAEU).
Language: reply in the language the student is speaking (Arabic or English) and switch immediately when they switch.
{{ARABIC_VOICE_STYLE}}
Style: warm, calm, brief spoken replies of one to three sentences. Never read lists, tables, links, IDs or field names aloud.
Interruption policy: stop speaking and listen as soon as the student interrupts.
Backchannel policy: use light listening sounds sparingly.
Delegation policy:
Backend tools: Sanadi's verified university assistant. It answers general and university questions from the approved Knowledge Center, checks the signed-in student's own records, eligibility and requests, provides career counselling, searches the library catalogue, and prepares service requests for on-screen confirmation.
Delegate to the backend when: the student asks any question about the university, admission, policies, courses, their own record, GPA, requests or case status, career guidance, the library, or asks for any service or action, or corrects a request already being handled.
Do not delegate to the backend when: greeting, saying goodbye, asking the student to repeat, or briefly clarifying what they mean.
Wait for the backend result before answering. Speak only what the backend returned; never invent facts, dates, names, availability or reference numbers.
Never say an action was completed, submitted or booked unless the backend result says so. When the backend says a confirmation is shown, ask the student to confirm it with the button below or by saying yes; both run the same action. Never say "check the screen"; say "I've displayed the details below."
Hostel booking and programme transfer: these work exactly like text chat through the backend. Never decide eligibility, room availability, transfer rules or capacity yourself — the backend's verified records and deterministic rules decide. Speak only the short conclusion (for example "You're eligible for a single room in Hostel A" or "Your GPA is below the 2.50 minimum") and say "I've displayed the full details below." Never read course-equivalency lists, room inventories, requirements tables or reference metadata aloud. When the student says a short confirmation such as "submit it", "yes" or "هيه", the backend continues the pending hostel or transfer request — do not restart the service or ask for details already given.
Pilot focus: general student inquiries, hostel room booking, programme and college transfer, career counselling and Ask-a-Librarian.`;

function isListeningSound(text: string) {
  const normalized = text.toLowerCase().replace(/[\s\p{Pd}]/gu, "");
  return /^(?:m+hm+|uhhuh)[.,!]*$/.test(normalized);
}

/**
 * Hands the student's spoken request to Sanadi's existing assistant (the same
 * turn handler text chat uses), as the verified student, in the same
 * conversation. Returns the short spoken version of the verified answer.
 */
/** Where the last verified backend answer ended, per call transcript. */
const handoffCursor = new WeakMap<ModelMessage[], number>();

async function answerQuestion(
  messages: ModelMessage[],
  student: Student,
  signal: AbortSignal,
  consumeInput: () => void,
  onResponse: (payload: SanadiPayload) => void,
) {
  signal.throwIfAborted();
  consumeInput();
  // The new request is everything the student said since the last verified
  // backend answer (Sanadi's own spoken filler lines are ignored).
  const cursor = handoffCursor.get(messages) ?? 0;
  const spoken = messages
    .slice(cursor)
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!spoken) throw new Error("No student request to hand over");
  const lang = detectSpokenLanguage(spoken);
  student.lang = lang;

  const { runAgentTurn } = await import("@/lib/agent/orchestrator.server");
  const response = await runAgentTurn({
    db: student.db as never,
    userId: student.userId,
    roles: student.roles.length ? student.roles : ["student"],
    message: spoken,
    conversationId: student.conversationId,
    uiLang: lang,
  });
  signal.throwIfAborted();
  if (response.conversationId) student.conversationId = response.conversationId;
  await recordVoiceTurn(student, response);
  onResponse({ response });
  messages.push({ role: "assistant", content: response.answer ?? "" });
  handoffCursor.set(messages, messages.length);

  const summary = spokenSummary({
    answer: response.answer ?? "",
    lang,
    hasPendingAction: (response.proposedActions ?? []).length > 0,
    hasDocument: Boolean(response.receipt),
  });
  if (!summary) throw new Error("The backend response had no answer");
  return `Verified Sanadi result to say to the student (${lang === "ar" ? "Arabic" : "English"}), briefly and naturally: ${summary}`;
}

async function recordVoiceTurn(student: Student, result: AgentResponse) {
  if (!student.conversationId) return;
  try {
    const db = student.db as ReturnType<typeof createClient<Database>>;
    const { data: msg } = await db
      .from("messages")
      .select("id, metadata")
      .eq("conversation_id", student.conversationId)
      .eq("user_id", student.userId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!msg) return;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("messages")
      .update({
        metadata: {
          ...((msg.metadata ?? {}) as Record<string, unknown>),
          channel: "voice",
          voice: {
            realtime: true,
            language: student.lang,
            transcribedAt: new Date().toISOString(),
            intent: result.classification?.intent ?? null,
            agent: result.agent ?? null,
            clarification: Boolean(result.clarifyingQuestion),
            actionProposed: (result.proposedActions ?? []).length > 0,
            actionCompleted: Boolean(result.receipt),
          },
        } as never,
      })
      .eq("id", msg.id);
  } catch {
    /* best effort; never blocks the call */
  }
}

/** Verifies the signed-in student's access token, like the chat stream endpoint. */
async function authenticateStudent(token: unknown): Promise<Omit<Student, "conversationId" | "lang" | "persona"> | null> {
  if (typeof token !== "string" || token.split(".").length !== 3) return null;
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  const isNewKey = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  const db = createClient<Database>(url, key, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isNewKey && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getClaims(token);
  const userId = data?.claims?.sub as string | undefined;
  if (error || !userId) return null;
  return { db, userId, roles: await getActiveRoles(db, userId) };
}

function* commentaryChunks(content: string) {
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const [word] of content.matchAll(/\S+\s*|\s+/gu)) {
    // Chunks stay well inside the provider's per-append size limit.
    if (chunk && bytes + encoder.encode(word).length > 480) {
      yield chunk;
      chunk = "";
      bytes = 0;
    }
    for (const character of word) {
      const size = encoder.encode(character).length;
      if (bytes + size > 480) {
        yield chunk;
        chunk = "";
        bytes = 0;
      }
      chunk += character;
      bytes += size;
    }
  }
  if (chunk) yield chunk;
}

export function bindLiveConnection(
  browser: LiveSocket,
  configuration: LiveConfig,
  execution: LiveExecutionContext,
  connect: LiveConnector,
): void {
  const config = { ...configuration };
  const runID = crypto.randomUUID();
  const setupAbort = new AbortController();
  let gateway: LiveSocket | undefined;
  let sessionID: string | undefined;
  let starting = false;
  let closing = false;
  let finished = false;
  let revision = 0;
  let task: AbortController | undefined;
  const pendingDelegations: Array<{
    event: ProviderEvent;
    plan?: SanadiPayload;
  }> = [];
  let completedDelegation: (typeof pendingDelegations)[number] | undefined;
  const backendMessages: ModelMessage[] = [];
  let transcriptCursor = 0;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let finishDrain: (() => void) | undefined;
  let browserReady = false;
  let greetingRequested = false;
  let greetingCommand: { id: string; type: "instructions" | "commentary" } | undefined;
  let greetingTimer: ReturnType<typeof setTimeout> | undefined;
  const startTimer = setTimeout(() => {
    emit({ type: "app.error", error: { message: "Voice startup message timed out" } });
    stop();
  }, 5000);
  const transcripts: Transcript[] = [];
  let student: Student | undefined;
  const delegations = new Set<string>();

  function emit(event: object) {
    if (browser.readyState !== 1) return;
    try {
      browser.send(JSON.stringify(event));
    } catch {
      stop();
    }
  }

  function close(socket?: LiveSocket) {
    if (!socket || socket.readyState === 3) return;
    try {
      socket.close(1000, "Call ended");
    } catch {
      return;
    }
  }

  function clearGreeting() {
    clearTimeout(greetingTimer);
    greetingCommand = undefined;
  }

  function requestGreeting() {
    const content = (
      config.openingInstructions ??
      "Start the conversation now in your configured language and role. Give a brief greeting suited to this app's purpose, ask one relevant opening question, then listen."
    ).trim();
    if (!content || !browserReady || !sessionID || greetingRequested || closing) return;
    greetingRequested = true;
    if (new TextEncoder().encode(content).length > 480) {
      emit({ type: "app.greeting.error", error: { message: "The opening instructions are too long" } });
      return;
    }
    // The opening is already part of the startup instructions, so one
    // commentary command starts the greeting (saves a full round-trip).
    greetingCommand = { id: crypto.randomUUID(), type: "commentary" };
    greetingTimer = setTimeout(() => {
      clearGreeting();
      emit({ type: "app.greeting.error", error: { message: "The opening could not be confirmed" } });
    }, 10_000);
    gateway?.send(
      JSON.stringify({
        type: "session.commentary.append",
        event_id: greetingCommand.id,
        delegation_id: null,
        content: "Begin the conversation now with the opening greeting described in your instructions.",
      }),
    );
  }

  function discardPendingWork() {
    pendingDelegations.length = 0;
    completedDelegation = undefined;
    clearTimeout(restartTimer);
    task?.abort();
  }

  function finish() {
    if (finished) return;
    finished = closing = true;
    clearTimeout(startTimer);
    clearTimeout(startupTimer);
    clearTimeout(closeTimer);
    clearTimeout(restartTimer);
    clearGreeting();
    discardPendingWork();
    setupAbort.abort();
    close(gateway);
    close(browser);
    finishDrain?.();
  }

  function stop() {
    if (closing) return;
    closing = true;
    discardPendingWork();
    clearTimeout(startupTimer);
    clearTimeout(startTimer);
    clearGreeting();
    if (gateway?.readyState === 1) {
      execution.waitUntil(
        new Promise<void>((resolve) => {
          finishDrain = resolve;
        }),
      );
      closeTimer = setTimeout(finish, 15_000);
      try {
        gateway.send(JSON.stringify({ type: "session.close" }));
      } catch {
        finish();
      }
    } else {
      finish();
    }
  }

  function scheduleDelegation() {
    clearTimeout(restartTimer);
    if (closing || task || pendingDelegations.length === 0) return;
    restartTimer = setTimeout(() => void runDelegation(), 300);
  }

  function deliverResult(delegationID: string, answer: string, plan?: SanadiPayload) {
    if (closing) return;
    if (gateway?.readyState !== 1) return stop();
    try {
      for (const content of commentaryChunks(answer)) {
        gateway.send(
          JSON.stringify({
            type: "session.commentary.append",
            event_id: crypto.randomUUID(),
            delegation_id: delegationID,
            content,
          }),
        );
      }
      
      completedDelegation = pendingDelegations.shift();
    } catch {
      stop();
    }
  }

  async function runDelegation() {
    const pending = pendingDelegations[0];
    const event = pending?.event;
    const id = event?.delegation?.id;
    if (!pending || !event || !id || closing || task) return;
    if (!transcripts.some(({ role, text }) => role === "user" && text.trim())) return;
    const controller = new AbortController();
    task = controller;
    let taskRevision = revision;
    try {
      if (!student) throw new Error("Not signed in");
      const answer = await answerQuestion(
        backendMessages,
        student,
        controller.signal,
        () => {
          const updates = transcripts.slice(transcriptCursor);
          backendMessages.push(...updates.map(({ role, text }) => ({ role, content: text })));
          transcriptCursor = transcripts.length;
          taskRevision = revision;
        },
        (payload) => {
          pending.plan = payload;
          // Cards, documents and approvals render in the chat right away.
          emit({ type: "app.sanadi.response", delegation_id: id, response: payload.response });
        },
      );
      if (closing || controller.signal.aborted) return;
      if (taskRevision !== revision) return;
      deliverResult(id, answer.trim(), pending.plan);
    } catch (error) {
      console.error("[live] handoff failed", error);
      if (closing || controller.signal.aborted) return;
      backendMessages.push({
        role: "assistant",
        content:
          "The backend attempt failed. Completed tool results remain valid; verify uncertain external actions before any retry.",
      });
      if (taskRevision !== revision) return;
      try {
        const { logException } = await import("@/lib/exceptions/handle.server");
        await logException("api_failure", {
          userId: student?.userId ?? null,
          conversationId: student?.conversationId ?? null,
          detail: "Realtime voice handoff to the assistant failed",
          context: { channel: "voice", stage: "realtime_delegation" },
          recovered: true,
          recoveryAction: "student_offered_retry_or_typing",
        });
      } catch {
        /* ignore */
      }
      deliverResult(
        id,
        "Sanadi's service could not finish this request right now. Apologise briefly, say nothing was submitted, and offer to try again or continue by typing.",
      );
    } finally {
      if (task === controller) task = undefined;
      scheduleDelegation();
    }
  }

  function queueDelegation(event: ProviderEvent) {
    pendingDelegations.push({ event });
    emit({ type: "app.delegation.pending", delegation_id: event.delegation?.id });
    scheduleDelegation();
  }

  function receiveGateway(data: unknown) {
    try {
      if (typeof data !== "string" || data.length > 1024 * 1024) throw new Error("Invalid voice event");
      const event: ProviderEvent = JSON.parse(data);
      if (browser.readyState === 1) browser.send(data);
      if (event.type === "session.closed") return finish();
      if (event.type === "gateway.session.closing" || event.type === "gateway.error" || event.type === "app.error") {
        return stop();
      }
      if (closing) return;
      if (event.type === "gateway.session.created") {
        sessionID = event.session?.id;
        clearTimeout(startupTimer);
        requestGreeting();
      }
      if (
        greetingCommand &&
        event.type === `session.${greetingCommand.type}.appended` &&
        event.client_event_id === greetingCommand.id
      ) {
        if (greetingCommand.type === "instructions") {
          greetingCommand = { id: crypto.randomUUID(), type: "commentary" };
          gateway?.send(
            JSON.stringify({
              type: "session.commentary.append",
              event_id: greetingCommand.id,
              delegation_id: null,
              content: "Begin the conversation now, following the instructions provided.",
            }),
          );
        } else {
          clearGreeting();
          emit({ type: "app.greeting.accepted" });
        }
      } else if (greetingCommand && event.type === "error" && event.error?.client_event_id === greetingCommand.id) {
        clearGreeting();
        emit({ type: "app.greeting.error", error: { message: event.error.message ?? "The opening was rejected" } });
      }
      if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
        const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
        if (!event.delta?.trim()) return;
        const listeningSound = role === "user" && Boolean(task) && isListeningSound(event.delta);
        transcripts.push({
          role,
          text: event.delta,
          start_ms: event.start_ms ?? 0,
          end_ms: event.end_ms ?? 0,
          listeningSound,
        });
        if (listeningSound) return;
        if (role === "user") {
          revision++;
          const offset = completedDelegation?.event.offset_ms;
          // Live has no transcript watermark; completed handoffs can receive late context.
          if (
            pendingDelegations.length === 0 &&
            completedDelegation &&
            typeof offset === "number" &&
            Number.isFinite(offset) &&
            offset >= 0 &&
            typeof event.start_ms === "number" &&
            Number.isFinite(event.start_ms) &&
            event.start_ms >= 0 &&
            event.start_ms <= offset
          ) {
            pendingDelegations.push(completedDelegation);
            completedDelegation = undefined;
          }
          if (pendingDelegations.length) {
            emit({ type: "app.delegation.pending", delegation_id: pendingDelegations[0]?.event.delegation?.id });
          }
        }
        scheduleDelegation();
      } else if (event.type === "session.delegation.created") {
        const id = event.delegation?.id;
        if (id && event.delegation?.target === "client" && !delegations.has(id)) {
          delegations.add(id);
          queueDelegation(event);
        }
      }
    } catch {
      emit({ type: "app.error", error: { message: "Invalid voice event or lost connection" } });
      stop();
    }
  }

  async function startSession(sdp: string, persona: keyof typeof PERSONAS) {
    if (closing || browser.readyState !== 1) return;
    clearTimeout(startTimer);
    startupTimer = setTimeout(() => {
      emit({ type: "app.error", error: { message: "Voice startup timed out" } });
      stop();
    }, 40_000);
    const accepted = await connect(
      new URL(`${gatewayAPIBase(config.baseURL)}/live/sessions`).href,
      {
        "Lovable-API-Key": config.key,
        "X-Lovable-AIG-SDK": "fetch",
        "X-Lovable-AIG-Run-ID": runID,
      },
      setupAbort.signal,
    );
    if (closing || browser.readyState !== 1) {
      close(accepted);
      return;
    }
    gateway = accepted;
    gateway.onMessage(receiveGateway);
    gateway.onClose(finish);
    gateway.onError(() => {
      emit({ type: "app.error", error: { message: "Voice gateway connection failed" } });
      stop();
    });
    gateway.send(
      JSON.stringify({
        type: "session.start",
        session: {
          model: config.liveModel,
          instructions:
            personaInstructions(persona).trim() +
            "\n" +
            conversationInstructions.replace("{{ARABIC_VOICE_STYLE}}", voiceStyleBlock(voiceArabicStyleNow())).replace(
              "You are Sanadi, the bilingual",
              `You are ${PERSONAS[persona].name}, the voice of Sanadi, the bilingual`,
            ) +
            (config.openingInstructions ? `\nOpening greeting (when told to begin): ${config.openingInstructions}` : ""),
          audio: { output: { voice: PERSONAS[persona].voice } },
          delegation: { type: "client" },
        },
        transport: { type: "webrtc", sdp },
      }),
    );
  }

  browser.onMessage((data) => {
    try {
      if (typeof data !== "string" || data.length > 64 * 1024) throw new Error("Invalid client message");
      const event = JSON.parse(data);
      if (event.type === "session.close") return stop();
      if (closing) return;
      if (!gateway) {
        if (starting || event.type !== "app.start" || typeof event.sdp !== "string" || !event.sdp.trim()) {
          throw new Error("Voice startup message required");
        }
        starting = true;
        execution.waitUntil(
          (async () => {
            // Verify the student and open the voice session in parallel so the
            // call connects faster; the student is verified before any request runs.
            const persona: keyof typeof PERSONAS = event.persona === "suhail" ? "suhail" : "meera";
            const lang: "ar" | "en" = event.lang === "ar" ? "ar" : "en";
            const p = PERSONAS[persona];
            config.openingInstructions =
              lang === "ar"
                ? `رحّب بالطالب بجملة قصيرة بلهجة إماراتية طبيعية ومحترمة: قل إنك ${p.nameAr} من سندي، خدمات الطلبة في جامعة الإمارات، واسأله: شو أقدر أساعدك فيه اليوم؟ ثم استمع.`
                : `Greet the student in one short English line: say you are ${p.name} from Sanadi, UAEU student services, and ask how you can help. Then listen.`;
            const auth = authenticateStudent(event.token).then((verified) => {
              if (!verified) throw new Error("Please sign in again to use voice.");
              student = {
                ...verified,
                conversationId:
                  typeof event.conversationId === "string" && /^[0-9a-f-]{36}$/i.test(event.conversationId)
                    ? event.conversationId
                    : null,
                lang,
                persona,
              };
            });
            await Promise.all([auth, startSession(event.sdp, persona)]);
          })().catch((error) => {
            if (!closing)
              emit({
                type: "app.error",
                error: { message: error instanceof Error ? error.message : "Voice startup failed" },
              });
            stop();
          }),
        );
        return;
      }
      if (event.type === "app.ready") {
        browserReady = true;
        requestGreeting();
        return;
      }
      if (event.type === "app.say" && typeof event.content === "string" && event.content.trim()) {
        // A verified on-screen result (e.g. a confirmed action and its
        // reference) for Sanadi to speak. Text only; never executes anything.
        if (gateway.readyState !== 1) return stop();
        for (const content of commentaryChunks(event.content.slice(0, 1200))) {
          gateway.send(
            JSON.stringify({ type: "session.commentary.append", event_id: crypto.randomUUID(), delegation_id: null, content }),
          );
        }
        return;
      }
      if (event.type !== "gateway.heartbeat") {
        throw new Error("Unsupported client event");
      }
      if (gateway.readyState !== 1) return stop();
      gateway.send(data);
    } catch {
      emit({ type: "app.error", error: { message: "Voice connection could not be started or continued" } });
      stop();
    }
  });
  browser.onClose(stop);
  browser.onError(stop);
}

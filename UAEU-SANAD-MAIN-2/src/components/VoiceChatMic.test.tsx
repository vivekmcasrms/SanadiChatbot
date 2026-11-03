import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VoiceChatMic, type VoiceChatMicControl } from "./VoiceChatMic";
import type { CallEvent } from "@/lib/voice-call";
import type { AgentResponse } from "@/lib/agent-types";

const state = vi.hoisted(() => ({
  receive: undefined as ((event: CallEvent) => void) | undefined,
  question: "",
  cuesEnabled: false, readyWelcome: false, readyGreeting: false, warmingGreeting: false,
  captureFeedback: undefined as ((context: { language: "en" | "ar"; skip: boolean; greetingReply?: { text: string; language: "en" | "ar" } }) => void) | undefined,
  feedback: undefined as { language: "en" | "ar"; skip: boolean; greetingReply?: { text: string; language: "en" | "ar" } } | undefined,
  turn: vi.fn(), greet: vi.fn(), interrupt: vi.fn(), played: vi.fn(), end: vi.fn(), play: vi.fn(), stopAudio: vi.fn(), error: vi.fn(), stopTrack: vi.fn(),
  userSpeech: undefined as (() => void) | undefined,
  finishCapture: undefined as ((text: string) => void) | undefined,
  captureSignal: undefined as AbortSignal | undefined,
  captureFailure: undefined as Error | undefined,
  isReplying: undefined as (() => boolean) | undefined,
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  forwardRef: (render: (props: unknown, ref: unknown) => unknown) => (props: { ref?: unknown }) => render(props, props.ref),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: vi.fn(), useLayoutEffect: vi.fn(),
  useImperativeHandle: (ref: { current: unknown }, create: () => unknown) => { ref.current = create(); },
}));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "en" }) }));
vi.mock("@/lib/auth-token", () => ({ apiFetch: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("@/lib/voice-call", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/voice-call")>(),
  openVoiceCall: async (_signal: AbortSignal, receive: (event: CallEvent) => void) => {
    state.receive = receive;
    return { turn: state.turn, greet: state.greet, played: state.played, end: state.end, interrupt: state.interrupt };
  },
}));
vi.mock("@/lib/wav-speech", () => ({ WavSpeech: class {
  prepare = async () => {};
  observe() {}
  play = state.play;
  stop = state.stopAudio;
  close() {} setMuted() {}
} }));
vi.mock("@/lib/multilingual-speech", () => ({ MultilingualSpeech: class { close() {} } }));
vi.mock("@/lib/voice-prompt-audio", () => ({ VoicePromptAudio: class {
  get enabled() { return state.cuesEnabled; }
  supportsGreetingReply() { return state.readyGreeting || state.warmingGreeting; }
  prepare = async () => {};
  pause() {}
  cancel() {}
  get(agent: string, language: string, kind: string) {
    if (kind === "greetingReply") return state.readyGreeting
      ? [{ id: `${agent}/${language}/${kind}`, text: `${language} fixed greeting`, wav: new ArrayBuffer(48) }] : [];
    if (kind === "welcome" && !state.readyWelcome || kind !== "welcome" && !state.cuesEnabled) return [];
    return [{ id: `${agent}/${language}/${kind}/0`, text: `${language} ${kind}`, wav: new ArrayBuffer(48) }];
  }
} }));
vi.mock("@/lib/multilingual-question", () => ({
  multilingualQuestion: (_engine: unknown, _language: unknown, signal: AbortSignal, started: () => void,
    options: { onUserSpeech: () => void; onFeedbackContext?: (context: { language: "en" | "ar"; skip: boolean }) => void;
      isReplying?: () => boolean }) => {
    state.userSpeech = options.onUserSpeech;
    state.isReplying = options.isReplying;
    state.captureSignal = signal;
    state.captureFeedback = options.onFeedbackContext;
    started();
    const question = state.question;
    const failure = state.captureFailure;
    state.captureFailure = undefined;
    if (question && state.feedback) options.onFeedbackContext?.(state.feedback);
    state.question = "";
    return {
      text: failure ? Promise.reject(failure) : question ? Promise.resolve(question) : new Promise<string>(resolve => {
        state.finishCapture = resolve;
        if (signal.aborted) resolve("");
        else signal.addEventListener("abort", () => resolve(""), { once: true });
      }),
      finish() {},
    };
  },
}));

const control: { current: VoiceChatMicControl | null } = { current: null };
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  state.receive = undefined;
  state.userSpeech = undefined;
  state.finishCapture = undefined;
  state.captureSignal = undefined;
  state.captureFailure = undefined;
  state.isReplying = undefined;
  state.question = "";
  state.cuesEnabled = false;
  state.readyWelcome = false;
  state.readyGreeting = false;
  state.warmingGreeting = false;
  state.captureFeedback = undefined;
  state.feedback = undefined;
  state.play.mockImplementation(async (_wav: ArrayBuffer, _signal: AbortSignal, started: () => void) => started());
  const track = { stop: state.stopTrack };
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
});
afterEach(() => {
  control.current?.stop();
  control.current = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each([
  { selected: "en", reply: "ar", question: "ما هي حالتي الأكاديمية؟", answer: "حالتك الأكاديمية على الشاشة." },
  { selected: "ar", reply: "en", question: "What is my academic status?", answer: "Your academic status is on screen." },
] as const)("plays and acknowledges the $reply response when $selected was selected", async ({ selected, reply, question, answer }) => {
  state.question = question;
  const props: ComponentProps<typeof VoiceChatMic> = {
    ref: control, agent: "mira", language: selected, conversationId: null, disabled: false,
    onTranscript: vi.fn(), onTranscriptPreview: vi.fn(), onSpeech: vi.fn(), onResult: vi.fn(),
    onActivity: vi.fn(), onEnd: vi.fn(),
  };
  const button = VoiceChatMic(props) as ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  const turnId = state.turn.mock.calls[0]![0].turnId as string;
  const response = { answer, proposedActions: [], citations: [], conversationId: "existing" };
  state.receive!({ type: "transcript", turnId, text: question, language: reply });
  const agent = { key: "academic", domain: "academic", displayName: "Configured agent",
    statusText: reply === "ar" ? "الوكيل يراجع سجلك الأكاديمي…" : "The agent is checking your academic record…" };
  state.receive!({ type: "stage", turnId: "interrupted", stage: "knowledge", agent });
  const activityCount = vi.mocked(props.onActivity).mock.calls.length;
  state.receive!({ type: "stage", turnId, stage: agent.key, agent });
  expect(props.onActivity).toHaveBeenCalledTimes(activityCount); // Voice does not show working-agent labels.
  state.receive!({ type: "result", turnId, response, language: reply } as unknown as CallEvent);
  const wav = new ArrayBuffer(48);
  state.receive!({ type: "audio", turnId, sequence: 0, text: answer, language: reply, agent: "mira", wav });
  state.receive!({ type: "done", turnId });

  await vi.waitFor(() => expect(state.played).toHaveBeenCalledWith(turnId, 0));
  expect(state.play).toHaveBeenCalledOnce();
  expect(props.onSpeech).toHaveBeenCalledWith(answer);
  expect(props.onResult).toHaveBeenCalledExactlyOnceWith(response);
  expect(props.onEnd).toHaveBeenCalledOnce();
  expect(state.error).not.toHaveBeenCalled();
  expect(state.end).not.toHaveBeenCalled();
});

function openMicrophone(language: "en" | "ar") {
  const props: ComponentProps<typeof VoiceChatMic> = {
    ref: control, agent: "mira", language, conversationId: null, disabled: false,
    onTranscript: vi.fn(), onTranscriptPreview: vi.fn(), onSpeech: vi.fn(), onResult: vi.fn(),
    onActivity: vi.fn(), onEnd: vi.fn(),
  };
  const button = VoiceChatMic(props) as ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  return props;
}

test("critical identifiers wait for review and only the corrected transcript is sent", async () => {
  state.question = "Show course MATH 101";
  const props = openMicrophone("en");
  await vi.waitFor(() => expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ state: "reviewing" })));
  expect(state.turn).not.toHaveBeenCalled();
  const activity = vi.mocked(props.onActivity).mock.calls.at(-1)![0]!;
  activity.review!.complete("Show course MATH 102");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  expect(state.turn).toHaveBeenCalledWith(expect.objectContaining({ message: "Show course MATH 102" }));
});

test("ending the call releases a pending transcript review without sending it", async () => {
  state.question = "Reference 12345";
  const props = openMicrophone("en");
  await vi.waitFor(() => expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ state: "reviewing" })));
  control.current!.stop();
  await vi.advanceTimersByTimeAsync(250);
  expect(state.turn).not.toHaveBeenCalled();
  expect(props.onActivity).toHaveBeenLastCalledWith(null);
  expect(state.stopTrack).toHaveBeenCalledOnce();
});

test("status-bar interruption discards a late response while leaving capture active", async () => {
  state.question = "What are the library hours?";
  const props = openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  const { turnId } = state.turn.mock.calls[0]![0];
  control.current!.interrupt();
  state.receive!({ type: "result", turnId, language: "en", response: { answer: "Old result" } as AgentResponse });
  expect(props.onResult).not.toHaveBeenCalled();
  expect(state.interrupt).toHaveBeenCalledWith(turnId);
  expect(state.end).not.toHaveBeenCalled();
  expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ state: "listening" }));
});

test.each(["en", "ar"] as const)("explicit interruption restores normal hands-free listening in %s without reopening the call", async language => {
  const props: ComponentProps<typeof VoiceChatMic> = {
    ref: control, agent: "mira", language, conversationId: null, disabled: false,
    onTranscript: vi.fn(), onTranscriptPreview: vi.fn(), onSpeech: vi.fn(), onResult: vi.fn(),
    onActivity: vi.fn(), onEnd: vi.fn(),
  };
  const button = VoiceChatMic(props) as ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  await vi.waitFor(() => expect(state.isReplying).toBeTypeOf("function"));
  expect(state.isReplying!()).toBe(true);
  button.props.onClick(); // Existing Interrupt and speak button.
  expect(state.isReplying!()).toBe(false);
  expect(state.interrupt).toHaveBeenCalledOnce();
  expect(state.end).not.toHaveBeenCalled();
  expect(state.stopTrack).not.toHaveBeenCalled();
  expect(state.greet).toHaveBeenCalledOnce();
});

function farewellResponse(answer: string, language: "en" | "ar"): AgentResponse {
  return {
    answer, agent: "query", conversationId: "existing", messageId: "farewell-message",
    classification: { intent: "query", category: "greeting", language, urgency: "low", sentiment: "positive",
      requiredUnitCode: null, requiredUnitName: null, requiresAuth: true, requiresStudentData: false,
      actionRequested: false, requiresHumanEscalation: false, confidence: 1 },
    responseType: "answer", verified: true, confidence: 1, fallbackUsed: false, humanHandoff: false,
    proposedActions: [], citations: [], intents: [], nextSteps: [], toolsUsed: ["greeting"],
    clarifyingQuestion: null, receipt: null, followUp: null,
  };
}

test.each(["en", "ar"] as const)("unrecognized language asks for repetition in %s and keeps the voice call available", async language => {
  state.readyWelcome = true;
  state.captureFailure = new Error("stt_unsupported_language");
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.error).toHaveBeenCalledOnce());
  expect(state.error.mock.calls[0]![0]).toBe(language === "ar"
    ? "لم أتمكن من فهم التسجيل بالعربية أو الإنجليزية. يرجى إعادة المحاولة."
    : "I couldn't recognize that in English or Arabic. Please try again.");
  expect(state.turn).not.toHaveBeenCalled();
  expect(props.onTranscript).not.toHaveBeenCalled();
  expect(state.end).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  state.userSpeech!();
  state.finishCapture!(language === "ar" ? "شكراً" : "Thank you");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  expect(state.turn.mock.calls[0]![0].message).toBe(language === "ar" ? "شكراً" : "Thank you");
  expect(state.stopTrack).not.toHaveBeenCalled();
});

test.each([
  { selected: "ar", detected: "en", question: "What are my courses?" },
  { selected: "en", detected: "ar", question: "ما هي مقرراتي؟" },
  { selected: "ar", detected: "en", question: "أريد review my courses" },
  { selected: "en", detected: "ar", question: "أريد معرفة تفاصيل مقرراتي في Computer Science" },
] as const)("acknowledges $detected input independently of $selected UI/output language", async ({ selected, detected, question }) => {
  state.cuesEnabled = true;
  state.question = question;
  state.feedback = { language: detected, skip: false };
  const props = openMicrophone(selected);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(150);
  expect(state.play).toHaveBeenCalledOnce();
  expect(props.onActivity).toHaveBeenCalledWith(expect.objectContaining({ detail: `${detected} initial` }));
  expect(props.onSpeech).not.toHaveBeenCalled(); // No acknowledgment is inserted into the answer.
  expect(state.turn.mock.calls[0]![0]).toMatchObject({ message: question, language: selected });
  const turnId = state.turn.mock.calls[0]![0].turnId;
  const response = { answer: "Unchanged final answer", proposedActions: [], verified: true };
  state.receive!({ type: "result", turnId, language: selected, response } as unknown as CallEvent);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(props.onResult).toHaveBeenCalledExactlyOnceWith(response);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.turn).toHaveBeenCalledOnce();
});

test.each(["ready", "simple", "disabled"])("%s response preserves the existing path without cues", async mode => {
  state.cuesEnabled = mode !== "disabled";
  state.question = "Question";
  state.feedback = { language: "en", skip: mode === "simple" };
  openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  const turnId = state.turn.mock.calls[0]![0].turnId;
  if (mode === "ready") state.receive!({ type: "result", turnId, language: "en", response: { answer: "Ready" } } as unknown as CallEvent);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(state.play).not.toHaveBeenCalled();
  expect(state.turn).toHaveBeenCalledOnce();
});

test.each([
  { language: "en", question: "Hello" },
  { language: "en", question: "Hello Mira" },
  { language: "en", question: "Hello Suhail" },
  { language: "ar", question: "مرحبا ميرا" },
  { language: "ar", question: "يا هلا وغلا، شحالج؟" },
  { language: "ar", question: "السلام عليكم يا سهيل" },
] as const)("$language greeting sends one normal turn and never plays processing cues: $question", async ({ language, question }) => {
  state.cuesEnabled = true;
  state.question = question;
  state.feedback = { language, skip: true };
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(15_000);
  expect(state.play).not.toHaveBeenCalled();
  const turnId = state.turn.mock.calls[0]![0].turnId;
  const response = { answer: language === "ar" ? "هلا ومرحبا." : "Hello!", toolsUsed: ["greeting"] };
  state.receive!({ type: "result", turnId, language, response } as unknown as CallEvent);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(props.onResult).toHaveBeenCalledExactlyOnceWith(response);
  expect(state.play).not.toHaveBeenCalled();
  expect(state.turn).toHaveBeenCalledOnce();
  expect(state.stopTrack).not.toHaveBeenCalled();
});

test.each(["error", "interrupt"])("a tool/API %s or new speech cancels waiting without replaying the request", async reason => {
  state.cuesEnabled = true; state.question = "Question"; state.feedback = { language: "en", skip: false };
  openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(3100);
  expect(state.play).toHaveBeenCalledTimes(2);
  const turnId = state.turn.mock.calls[0]![0].turnId;
  if (reason === "error") state.receive!({ type: "error", turnId, error: "assistant_api_unavailable" });
  else state.userSpeech!();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.interrupt).toHaveBeenCalledWith(turnId);
  expect(state.play).toHaveBeenCalledTimes(2);
  expect(state.turn).toHaveBeenCalledOnce();
  expect(state.error).toHaveBeenCalledTimes(reason === "error" ? 1 : 0);
});

test.each(["en", "ar"] as const)("$0 reply audio waits for active speech and finishes every queued sentence", async language => {
  state.cuesEnabled = true; state.question = "Question"; state.feedback = { language, skip: false };
  const pending: { finish: () => void; signal: AbortSignal }[] = [];
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    started();
    return new Promise<void>((resolve, reject) => {
      pending.push({ finish: resolve, signal });
      signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")), { once: true });
    });
  });
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(150);
  expect(state.play).toHaveBeenCalledOnce();
  const turnId = state.turn.mock.calls[0]![0].turnId;
  const response = { answer: "Confirmed response" };
  state.receive!({ type: "result", turnId, language, response } as unknown as CallEvent);
  for (const sequence of [0, 1])
    state.receive!({ type: "audio", turnId, sequence, text: `Sentence ${sequence}`, language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.stopAudio).not.toHaveBeenCalled();
  expect(pending[0]!.signal.aborted).toBe(false);
  expect(props.onResult).toHaveBeenCalledExactlyOnceWith(response);
  expect(props.onEnd).not.toHaveBeenCalled();
  pending[0]!.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.play).toHaveBeenCalledTimes(3); // Existing prefetch schedules the two answer sentences.
  expect(state.played).not.toHaveBeenCalled();
  pending[1]!.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.played).toHaveBeenCalledExactlyOnceWith(turnId, 0);
  expect(props.onEnd).not.toHaveBeenCalled();
  pending[2]!.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.played).toHaveBeenLastCalledWith(turnId, 1);
  expect(props.onEnd).toHaveBeenCalledOnce();
  expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ state: "listening" }));
  expect(state.stopAudio).not.toHaveBeenCalled();
  expect(state.end).not.toHaveBeenCalled();
  expect(state.stopTrack).not.toHaveBeenCalled();
});

test.each([
  { language: "en", reason: "question" }, { language: "ar", reason: "question" },
  { language: "en", reason: "end" }, { language: "ar", reason: "end" },
] as const)("$reason cancels current $language speech and queued audio without replay", async ({ language, reason }) => {
  state.cuesEnabled = true; state.question = "Question"; state.feedback = { language, skip: false };
  let speechSignal!: AbortSignal;
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    speechSignal = signal; started();
    return new Promise<void>((_resolve, reject) => signal.addEventListener("abort",
      () => reject(new DOMException("Interrupted", "AbortError")), { once: true }));
  });
  openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(250);
  const turnId = state.turn.mock.calls[0]![0].turnId;
  state.receive!({ type: "audio", turnId, sequence: 0, text: "Queued answer", language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId });
  expect(state.play).toHaveBeenCalledOnce();
  if (reason === "question") {
    const capture = state.captureSignal!;
    state.userSpeech!();
    expect(capture.aborted).toBe(false);
    const question = language === "ar" ? "ما هو معدلي؟" : "What is my GPA?";
    state.finishCapture!(question);
    await vi.waitFor(() => expect(state.turn).toHaveBeenCalledTimes(2));
    expect(state.turn.mock.calls[1]![0].message).toBe(question);
    expect(state.end).not.toHaveBeenCalled();
    expect(state.stopTrack).not.toHaveBeenCalled();
  } else control.current!.stop();
  expect(speechSignal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.played).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("prepared %s welcome plays immediately without another server greeting request", async language => {
  state.readyWelcome = true;
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.play).toHaveBeenCalledOnce());
  expect(props.onSpeech).toHaveBeenCalledWith(`${language} welcome`);
  expect(state.greet).not.toHaveBeenCalled();
  expect(state.turn).not.toHaveBeenCalled();
  expect(state.userSpeech).toBeTypeOf("function");
});

test("a failed cached welcome keeps the original server greeting fallback", async () => {
  state.readyWelcome = true;
  state.play.mockRejectedValueOnce(new Error("bad optional cache"));
  openMicrophone("en");
  await vi.waitFor(() => expect(state.greet).toHaveBeenCalledOnce());
  expect(state.error).not.toHaveBeenCalled();
  expect(state.turn).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("prepared %s greeting starts before a delayed backend reply, runs one backend turn, and never plays twice", async language => {
  state.readyGreeting = true;
  state.question = language === "ar" ? "مرحبا ميرا" : "Hello Mira";
  const answer = `${language} fixed greeting`;
  state.feedback = { language, skip: true, greetingReply: { text: answer, language } };
  let finish!: () => void;
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    started();
    return new Promise<void>((resolve, reject) => {
      finish = resolve;
      signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")), { once: true });
    });
  });
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  // No transcript/result/audio from the websocket is needed to begin this public greeting.
  expect(state.play).toHaveBeenCalledOnce();
  expect(props.onSpeech).toHaveBeenCalledWith(answer);
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.play).toHaveBeenCalledOnce();
  const turnId = state.turn.mock.calls[0]![0].turnId;
  state.receive!({ type: "transcript", turnId, text: state.turn.mock.calls[0]![0].message, language });
  const response = farewellResponse(answer, language);
  state.receive!({ type: "result", turnId, language, response });
  state.receive!({ type: "audio", turnId, sequence: 0, text: answer, language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId });
  expect(state.played).not.toHaveBeenCalled();
  expect(props.onResult).toHaveBeenCalledExactlyOnceWith(response);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.played).toHaveBeenCalledExactlyOnceWith(turnId, 0);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.turn).toHaveBeenCalledOnce();
  expect(props.onEnd).toHaveBeenCalledOnce();
  expect(state.stopTrack).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("%s greeting prepared during capture is usable for the first question with cues disabled", async language => {
  state.warmingGreeting = true;
  openMicrophone(language);
  await vi.waitFor(() => expect(state.captureFeedback).toBeDefined());
  expect(state.play).not.toHaveBeenCalled();
  state.userSpeech!();
  state.readyGreeting = true;
  state.captureFeedback!({ language, skip: true, greetingReply: { text: `${language} fixed greeting`, language } });
  state.finishCapture!(language === "ar" ? "مرحبا سهيل" : "Hello Suhail");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.cuesEnabled).toBe(false);
});

test.each(["missing", "mismatch", "service"])("%s greeting preparation keeps the ordinary response path", async mode => {
  state.readyGreeting = mode !== "missing";
  state.question = mode === "service" ? "Hello, show my courses" : "Hello Mira";
  state.feedback = { language: "en", skip: mode !== "service",
    ...(mode !== "service" ? { greetingReply: { text: mode === "mismatch" ? "Different greeting" : "en fixed greeting", language: "en" as const } } : {}) };
  openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  expect(state.play).not.toHaveBeenCalled();
  const turnId = state.turn.mock.calls[0]![0].turnId;
  state.receive!({ type: "audio", turnId, sequence: 0, text: "Existing response", language: "en", agent: "mira", wav: new ArrayBuffer(48) });
  expect(state.play).toHaveBeenCalledOnce();
});

test("a damaged prepared greeting falls back to server audio without running the chat turn again", async () => {
  state.readyGreeting = true; state.question = "Hello Mira";
  state.feedback = { language: "en", skip: true, greetingReply: { text: "en fixed greeting", language: "en" } };
  state.play.mockRejectedValueOnce(new Error("cached_audio_decode_failed"));
  openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(0);
  const turnId = state.turn.mock.calls[0]![0].turnId;
  state.receive!({ type: "result", turnId, language: "en", response: farewellResponse("en fixed greeting", "en") });
  state.receive!({ type: "audio", turnId, sequence: 0, text: "en fixed greeting", language: "en", agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.play).toHaveBeenCalledTimes(2);
  expect(state.turn).toHaveBeenCalledOnce();
  expect(state.error).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("a new %s question interrupts an early greeting and stale server audio cannot replay it", async language => {
  state.readyGreeting = true; state.question = language === "ar" ? "مرحبا" : "Hello";
  const answer = `${language} fixed greeting`;
  state.feedback = { language, skip: true, greetingReply: { text: answer, language } };
  let speechSignal!: AbortSignal;
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    speechSignal = signal; started();
    return new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError")), { once: true }));
  });
  openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(250);
  const old = state.turn.mock.calls[0]![0].turnId;
  state.userSpeech!();
  expect(speechSignal.aborted).toBe(true);
  state.finishCapture!(language === "ar" ? "ما هي مقرراتي؟" : "What are my courses?");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledTimes(2));
  state.receive!({ type: "audio", turnId: old, sequence: 0, text: answer, language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId: old });
  await vi.advanceTimersByTimeAsync(0);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.error).not.toHaveBeenCalled();
  expect(state.stopTrack).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("new %s speech interrupts a prepared welcome without replaying it or delaying the question", async language => {
  state.readyWelcome = true;
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    started();
    return new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError"))));
  });
  openMicrophone(language);
  await vi.waitFor(() => expect(state.play).toHaveBeenCalledOnce());
  state.userSpeech!();
  state.finishCapture!("My next question");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  expect(state.turn.mock.calls[0]![0].message).toBe("My next question");
  expect(state.stopAudio).toHaveBeenCalledOnce();
  expect(state.greet).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("confirmed %s speech stops the reply immediately and keeps the new question on the same call", async language => {
  state.question = language === "ar" ? "ما هي مقرراتي؟" : "What are my courses?";
  let playbackSignal!: AbortSignal;
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    playbackSignal = signal;
    started();
    return new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError"))));
  });
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(250);
  const oldTurn = state.turn.mock.calls[0]![0].turnId;
  const capture = state.captureSignal!;
  state.receive!({ type: "audio", turnId: oldTurn, sequence: 0, text: "Reply", language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId: oldTurn });
  expect(state.play).toHaveBeenCalledOnce();
  state.userSpeech!();
  expect(playbackSignal.aborted).toBe(true);
  expect(state.stopAudio).toHaveBeenCalledOnce();
  expect(state.interrupt).toHaveBeenCalledExactlyOnceWith(oldTurn);
  expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ state: "listening" }));
  expect(capture.aborted).toBe(false);
  const question = language === "ar" ? "ما هو معدلي؟" : "What is my GPA?";
  state.finishCapture!(question);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledTimes(2));
  expect(state.turn.mock.calls[1]![0].message).toBe(question);
  // Late frames from the cancelled reply cannot resume speech or finish the new turn.
  state.receive!({ type: "audio", turnId: oldTurn, sequence: 1, text: "Old reply", language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId: oldTurn });
  await vi.advanceTimersByTimeAsync(250);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.end).not.toHaveBeenCalled();
  expect(state.stopTrack).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});

test("muting while an acknowledgment plays cancels optional speech and preserves the business request", async () => {
  state.cuesEnabled = true; state.question = "Question"; state.feedback = { language: "en", skip: false };
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    started();
    return new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Interrupted", "AbortError"))));
  });
  openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(150);
  control.current!.toggleMute();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.stopAudio).toHaveBeenCalledOnce();
  expect(state.interrupt).not.toHaveBeenCalled();
  expect(state.turn).toHaveBeenCalledOnce();
});

test.each([
  { language: "en", question: "Thank you", farewell: "You're welcome! Happy to help. Goodbye!" },
  { language: "ar", question: "شكراً", farewell: "العفو، حياك الله! يسعدني أساعدك. مع السلامة." },
] as const)("ends the $language call and releases the microphone only after the farewell finishes", async ({ language, question, farewell }) => {
  let finishAudio!: () => void;
  state.question = question;
  state.play.mockImplementation((_wav: ArrayBuffer, _signal: AbortSignal, started: () => void) => {
    started();
    return new Promise<void>(resolve => { finishAudio = resolve; });
  });
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(250);
  const capture = state.captureSignal!;
  const lateActivity = state.userSpeech!;
  const { turnId } = state.turn.mock.calls[0]![0];
  state.receive!({ type: "audio", turnId, sequence: 0, text: farewell, language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId, endCall: true });
  expect(capture.aborted).toBe(true); // Also supports servers that signal sign-off only in done.
  lateActivity();
  expect(state.interrupt).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(state.play).toHaveBeenCalledOnce());
  expect(state.end).not.toHaveBeenCalled();
  expect(state.stopTrack).not.toHaveBeenCalled();
  finishAudio();
  await vi.waitFor(() => expect(state.end).toHaveBeenCalledOnce());
  expect(state.stopTrack).toHaveBeenCalledOnce();
  expect(props.onSpeech).toHaveBeenCalledWith(farewell);
  expect(props.onEnd).toHaveBeenCalledOnce();
  const activity = vi.mocked(props.onActivity).mock.calls;
  expect(activity[activity.length - 1]?.[0]).toBeNull();
  expect(state.error).not.toHaveBeenCalled();
});

test.each([
  { language: "en", question: "Thank you", farewell: "You're welcome! Happy to help. Goodbye!" },
  { language: "ar", question: "شكراً", farewell: "العفو، حياك الله! يسعدني أساعدك. مع السلامة." },
  { language: "ar", question: "Shukran", farewell: "العفو، حياك الله! يسعدني أساعدك. مع السلامة." },
] as const)("confirmed farewell stops capture before playback so microphone activity cannot cancel hang-up: $question", async ({ language, question, farewell }) => {
  let finishAudio!: () => void;
  state.question = question;
  state.play.mockImplementation((_wav: ArrayBuffer, _signal: AbortSignal, started: () => void) => {
    started();
    return new Promise<void>(resolve => { finishAudio = resolve; });
  });
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(250);
  const capture = state.captureSignal!;
  const lateActivity = state.userSpeech!;
  expect(capture.aborted).toBe(false);
  const { turnId } = state.turn.mock.calls[0]![0];
  const response = farewellResponse(farewell, language);
  state.receive!({ type: "result", turnId, response, language, endCall: true });
  expect(capture.aborted).toBe(true);
  lateActivity(); // A queued VAD callback / farewell loudspeaker echo must not cancel the closing turn.
  state.receive!({ type: "audio", turnId, sequence: 0, text: farewell, language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId, endCall: true });
  await vi.advanceTimersByTimeAsync(500);
  expect(state.interrupt).not.toHaveBeenCalled();
  expect(state.turn).toHaveBeenCalledOnce();
  expect(state.end).not.toHaveBeenCalled();
  expect(state.play).toHaveBeenCalledOnce();
  finishAudio();
  await vi.waitFor(() => expect(state.end).toHaveBeenCalledOnce());
  expect(state.stopTrack).toHaveBeenCalledOnce();
  expect(props.onSpeech).toHaveBeenCalledWith(farewell);
  expect(props.onResult).toHaveBeenCalledWith(response);
  expect(state.error).not.toHaveBeenCalled();
});

test("farewell synthesis failure releases the closing wait and retains existing error recovery", async () => {
  state.question = "Thank you";
  openMicrophone("en");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(250);
  const previousCapture = state.captureSignal!;
  const { turnId } = state.turn.mock.calls[0]![0];
  state.receive!({ type: "result", turnId, language: "en", endCall: true,
    response: farewellResponse("You're welcome!", "en") });
  await vi.advanceTimersByTimeAsync(250);
  expect(previousCapture.aborted).toBe(true);
  state.receive!({ type: "error", turnId, error: "tts_service_unavailable" });
  await vi.waitFor(() => expect(state.captureSignal).not.toBe(previousCapture));
  expect(state.captureSignal!.aborted).toBe(false);
  expect(state.interrupt).toHaveBeenCalledWith(turnId);
  expect(state.error).toHaveBeenCalledOnce();
  expect(state.end).not.toHaveBeenCalled();
  control.current!.stop();
  expect(state.end).toHaveBeenCalledOnce();
  expect(state.stopTrack).toHaveBeenCalledOnce();
});

test.each([
  { language: "en", question: "What skills am I missing?", overview: "Your analysis identifies two skills to develop." },
  { language: "ar", question: "ما المهارات التي تنقصني؟", overview: "يحدد تحليلك مهارتين تحتاج إلى تطويرهما." },
] as const)("keeps the complete $language text response while speaking only its overview", async ({ language, question, overview }) => {
  state.question = question;
  const props: ComponentProps<typeof VoiceChatMic> = {
    ref: control, agent: "mira", language, conversationId: "same-conversation", disabled: false,
    onTranscript: vi.fn(), onTranscriptPreview: vi.fn(), onSpeech: vi.fn(), onResult: vi.fn(),
    onActivity: vi.fn(), onEnd: vi.fn(),
  };
  const button = VoiceChatMic(props) as ReactElement<{ onClick: () => void }>;
  button.props.onClick();
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  const input = state.turn.mock.calls[0]![0];
  expect(input).toMatchObject({ message: question, language, conversationId: "same-conversation", agent: "mira" });
  const response = {
    answer: `${overview}\n\n**Details**\n- SQL\n- Statistics\n\n[Full analysis](/career)`,
    conversationId: "same-conversation", messageId: "confirmed-message", agent: "career",
    careerInsight: { skillGaps: { missing: ["SQL", "Statistics"] } },
    proposedActions: [], citations: [{ title: "Verified analysis" }], nextSteps: ["/career"], verified: true,
  };
  const original = JSON.stringify(response);
  state.receive!({ type: "transcript", turnId: input.turnId, text: question, language });
  state.receive!({ type: "result", turnId: input.turnId, response, language } as unknown as CallEvent);
  state.receive!({ type: "audio", turnId: input.turnId, sequence: 0, text: overview, language,
    agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId: input.turnId });
  await vi.waitFor(() => expect(state.played).toHaveBeenCalledWith(input.turnId, 0));
  expect(props.onResult).toHaveBeenCalledExactlyOnceWith(response);
  expect(props.onSpeech).toHaveBeenCalledExactlyOnceWith(overview);
  expect(JSON.stringify(response)).toBe(original);
  expect(state.turn).toHaveBeenCalledOnce();
  expect(state.error).not.toHaveBeenCalled();
});

test.each(["en", "ar"] as const)("microphone opens with a %s welcome, without submitting a question", async language => {
  const props = openMicrophone(language);
  await vi.waitFor(() => expect(state.greet).toHaveBeenCalledOnce());
  const { turnId } = state.greet.mock.calls[0]![0] as { turnId: string };
  expect(state.greet).toHaveBeenCalledWith({ turnId, agent: "mira", language });
  expect(state.userSpeech).toBeTypeOf("function"); // Capture is already available during welcome playback.
  state.receive!({ type: "audio", turnId, sequence: 0, text: "Welcome", language, agent: "mira", wav: new ArrayBuffer(48) });
  state.receive!({ type: "done", turnId });
  await vi.waitFor(() => expect(props.onActivity).toHaveBeenLastCalledWith(expect.objectContaining({ state: "listening" })));
  expect(state.played).toHaveBeenCalledWith(turnId, 0);
  expect(state.turn).not.toHaveBeenCalled();
  expect(props.onTranscript).not.toHaveBeenCalled();
  expect(props.onResult).not.toHaveBeenCalled();
  expect(state.error).not.toHaveBeenCalled();
});

test("speaking interrupts the welcome and submits one question without repeating the introduction", async () => {
  state.play.mockImplementation((_wav: ArrayBuffer, signal: AbortSignal, started: () => void) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener("abort",
      () => reject(new DOMException("Interrupted", "AbortError")), { once: true }));
  });
  openMicrophone("en");
  await vi.waitFor(() => expect(state.greet).toHaveBeenCalledOnce());
  const { turnId } = state.greet.mock.calls[0]![0] as { turnId: string };
  const welcome: CallEvent = { type: "audio", turnId, sequence: 0, text: "Welcome", language: "en", agent: "mira", wav: new ArrayBuffer(48) };
  state.receive!(welcome);
  state.userSpeech!();
  expect(state.interrupt).toHaveBeenCalledWith(turnId);
  expect(state.stopAudio).toHaveBeenCalledOnce();
  state.receive!(welcome); // Late cancelled audio cannot restart the introduction.
  state.finishCapture!("My question");
  await vi.waitFor(() => expect(state.turn).toHaveBeenCalledOnce());
  expect(state.turn).toHaveBeenCalledWith(expect.objectContaining({ message: "My question", introduce: false }));
  expect(state.play).toHaveBeenCalledOnce();
  expect(state.greet).toHaveBeenCalledOnce();
  expect(state.error).not.toHaveBeenCalled();
});

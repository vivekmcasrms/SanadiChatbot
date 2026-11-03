import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { Loader2, PhoneCall, PhoneOff, Square, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { VoiceTurns } from "@/lib/advisor-audio";
import { multilingualQuestion } from "@/lib/multilingual-question";
import { MultilingualSpeech, type VoiceFeedbackContext } from "@/lib/multilingual-speech";
import { WavSpeech } from "@/lib/wav-speech";
import type { VoiceSpectrum } from "@/lib/voice-spectrum";
import { openVoiceCall, finishVoiceTurn, type VoiceCall, type CallEvent } from "@/lib/voice-call";
import { isVoiceCallEcho } from "@/lib/voice-call-echo";
import { VoicePromptAudio } from "@/lib/voice-prompt-audio";
import { VoiceProcessingCues } from "@/lib/voice-processing-cues";
import type { AdvisorIdentity, AdvisorLanguage } from "@/lib/advisor-client";
import type { AgentResponse } from "@/lib/agent-types";
import { apiFetch } from "@/lib/auth-token";

export type VoiceChatMicControl = { stop: () => void; reset: () => void; toggleMute: () => void; interrupt: () => void };
type State = "idle" | "opening" | "listening" | "processing" | "speaking" | "reviewing";
export type VoiceChatActivity = { state: Exclude<State, "idle">; detail: string | null; muted: boolean; spectrum?: VoiceSpectrum | null;
  review?: { text: string; complete: (text: string | null) => void } };
const restingVoiceBarHeights = [16, 27, 21, 32, 24, 29, 18];
type Props = {
  agent: AdvisorIdentity;
  language: "en" | "ar";
  conversationId: string | null;
  disabled: boolean;
  onTranscript: (text: string) => void;
  onTranscriptPreview: (text: string) => void;
  onSpeech: (text: string) => void;
  onResult: (response: AgentResponse) => void;
  onActivity: (activity: VoiceChatActivity | null) => void;
  onEnd: () => void;
};

/** Compact, inline presentation of the mic's actual lifecycle. */
export function VoiceChatStatusBar({ agent, activity, onMute, onEnd, onInterrupt }: {
  agent: AdvisorIdentity;
  activity: VoiceChatActivity;
  onMute: () => void;
  onEnd: () => void;
  onInterrupt?: () => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const name = agent === "mira" ? (ar ? "ميرا" : "Mira") : (ar ? "سهيل" : "Suhail");
  const labels = {
    opening: ar ? "فتح الميكروفون" : "Opening microphone",
    listening: ar ? "أسمعك" : "Listening",
    processing: ar ? "جارٍ تجهيز الرد" : "Preparing reply",
    speaking: ar ? "أتحدث" : "Speaking",
    reviewing: ar ? "راجع التفاصيل" : "Review important details",
  };
  const bars = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const elements = bars.current?.children;
    const spectrum = activity.spectrum;
    if (!elements) return;
    const fills = Array.from(elements).map(element => element.firstElementChild as HTMLElement);
    const reset = () => fills.forEach(fill => { fill.style.transform = "scaleY(0)"; });
    reset();
    if (!spectrum) return;
    let frame = 0;
    const draw = () => {
      const levels = spectrum.read();
      const audible = levels.some(level => level > .02);
      fills.forEach((fill, index) => {
        const level = levels[index] ?? 0;
        fill.style.transform = `scaleY(${audible && level > .02 ? Math.min(1, level) : 0})`;
      });
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(frame); reset(); };
  }, [activity.spectrum]);
  const muteLabel = activity.muted
    ? (ar ? "تشغيل صوت المساعد" : "Unmute agent audio")
    : (ar ? "كتم صوت المساعد" : "Mute agent audio");
  return <div role="region" aria-label={ar ? "المحادثة الصوتية النشطة" : "Active voice chat"}
    data-state={activity.state} dir={ar ? "rtl" : "ltr"}
    className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-3 py-2 card-shadow">
    <div className="flex min-w-0 flex-1 basis-40 items-center gap-2">
      <img src={agent === "mira" ? "/mira-support-agent.png" : "/suhail-support-agent.png"}
        alt="" className="size-9 shrink-0 rounded-full object-cover" />
      <div ref={bars} aria-hidden className="hidden h-10 shrink-0 items-center gap-0.5 overflow-hidden text-primary sm:flex">
        {restingVoiceBarHeights.map((height, index) => <span key={index}
          className="relative block w-0.5 shrink-0 overflow-hidden rounded-full bg-primary/25"
          style={{ height }}>
          <span className="absolute inset-0 origin-bottom rounded-full bg-current transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: "scaleY(0)" }} />
        </span>)}
      </div>
      <div className="min-w-0 flex-1">
        <p role="status" aria-live="polite" aria-atomic="true" className="text-xs font-semibold text-primary">
          {name} · {labels[activity.state]}
        </p>
        <p dir="auto" title={activity.detail ?? undefined} className="truncate text-xs text-muted-foreground">
          {activity.state === "speaking" ? `${name}: ${activity.detail}` : activity.detail}
        </p>
      </div>
    </div>
    {activity.review && <TranscriptReview key={activity.review.text} review={activity.review} ar={ar} />}
    <div className="ms-auto flex shrink-0 items-center gap-1">
      {onInterrupt && (activity.state === "speaking" || activity.state === "processing") &&
        <Button type="button" variant="outline" size="sm" onClick={onInterrupt}>{ar ? "مقاطعة والتحدث" : "Interrupt and speak"}</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={onMute}
        aria-label={muteLabel} title={muteLabel} aria-pressed={activity.muted} className="gap-1.5 px-2">
        {activity.muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
        {activity.muted ? (ar ? "تشغيل الصوت" : "Unmute") : (ar ? "كتم الصوت" : "Mute")}
      </Button>
      <Button type="button" size="sm" onClick={onEnd} disabled={activity.state === "opening"} className="gap-1.5">
        <PhoneOff aria-hidden />{ar ? "إنهاء المكالمة" : "End call"}
      </Button>
    </div>
  </div>;
}

function TranscriptReview({ review, ar }: { review: NonNullable<VoiceChatActivity["review"]>; ar: boolean }) {
  const [text, setText] = useState(review.text);
  return <div className="basis-full space-y-2">
    <p className="text-sm">{ar ? "راجع الأسماء والأرقام والتواريخ قبل إرسال السؤال." : "Check names, codes, numbers, and dates before sending this question."}</p>
    <textarea aria-label={ar ? "النص المسموع" : "Recognized question"} className="w-full rounded border bg-background p-2" dir="auto"
      value={text} onChange={event => setText(event.target.value)} maxLength={6000} />
    <Button type="button" disabled={!text.trim()} onClick={() => review.complete(text.trim())}>{ar ? "تأكيد النص وإرسال" : "Confirm text and send"}</Button>{" "}
    <Button type="button" variant="outline" onClick={() => review.complete(null)}>{ar ? "إعادة المحاولة" : "Say it again"}</Button>
  </div>;
}

/** Browser recognition and server WAV playback surround the existing agent call. */
export const VoiceChatMic = forwardRef<VoiceChatMicControl, Props>(function VoiceChatMic(props, ref) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const callbacks = useRef(props);
  callbacks.current = props;
  const [state, setState] = useState<State>("idle");
  const currentState = useRef<State>("idle");
  const turns = useRef(new VoiceTurns());
  const callAbort = useRef<AbortController | null>(null);
  const captureAbort = useRef<AbortController | null>(null);
  const call = useRef<VoiceCall | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const activeTurn = useRef<{ id: string; controller: AbortController; identity: AdvisorIdentity;
    language: AdvisorLanguage; replyLanguage: AdvisorLanguage; ending?: boolean;
    inputEndedAt?: number; firstPlaybackRecorded?: boolean;
    preparedGreeting?: { text: string; started: boolean; failed: boolean; confirmed: boolean; playback: Promise<void> } } | null>(null);
  const speechQueue = useRef(Promise.resolve());
  const recentSpeech = useRef({ text: "", at: 0 });
  const audibleSequence = useRef<number | null>(null);
  const playback = useRef(new WavSpeech());
  const recognition = useRef(new MultilingualSpeech());
  const muted = useRef(false);
  const review = useRef<VoiceChatActivity["review"]>(undefined);
  const statusText = useRef<string | null>(null);
  const recording = useRef<{ finish: () => void } | null>(null);
  const introduced = useRef(new Set<AdvisorIdentity>());
  const prompts = useRef(new VoicePromptAudio());
  const cues = useRef<VoiceProcessingCues | null>(null);
  if (!cues.current) cues.current = new VoiceProcessingCues(async (clip, signal) => {
    const current = activeTurn.current;
    if (!current || signal.aborted) return;
    await playback.current.play(clip.wav.slice(0), signal, () => {
      if (signal.aborted || activeTurn.current !== current || !turns.current.isCurrent(current.controller)) return;
      recentSpeech.current = { text: `${recentSpeech.current.text} ${clip.text}`.slice(-1600), at: Date.now() };
      // Status and echo protection only. Never insert a cue into the transcript or final response.
      status("processing", clip.text);
    });
  }, () => playback.current.stop());
  useEffect(() => {
    const warmup = new AbortController();
    void prompts.current.prepare(props.agent, props.language, warmup.signal);
    return () => warmup.abort();
  }, [props.agent, props.language]);
  function status(next: State, text: string | null) {
    currentState.current = next;
    statusText.current = text;
    setState(next);
    callbacks.current.onActivity(next === "idle" ? null : { state: next, detail: text, muted: muted.current, spectrum: playback.current.spectrum,
      ...(review.current ? { review: review.current } : {}) });
  }
  function stop(preservePreparation = false) {
    review.current?.complete(null);
    review.current = undefined;
    const active = currentState.current !== "idle";
    cues.current?.cancel();
    if (!preservePreparation) prompts.current.cancel();
    call.current?.end();
    call.current = null;
    callAbort.current?.abort();
    callAbort.current = null;
    captureAbort.current?.abort();
    captureAbort.current = null;
    turns.current.cancel();
    activeTurn.current = null;
    speechQueue.current = Promise.resolve();
    playback.current.close();
    recognition.current.close();
    microphoneStream.current?.getTracks().forEach(track => track.stop());
    microphoneStream.current = null;
    recording.current = null;
    muted.current = false;
    callbacks.current.onTranscriptPreview("");
    status("idle", null);
    if (active) callbacks.current.onEnd();
  }
  function interrupt() {
    cues.current?.cancel();
    const previous = activeTurn.current;
    if (previous) {
      void apiFetch("/api/voice/metrics", { method: "POST", body: JSON.stringify({ type: "interrupted",
        language: previous.language, turnId: previous.id }) }).catch(() => {});
      try { call.current?.interrupt(previous.id); } catch { /* disconnect handler ends the call */ }
      turns.current.cancel();
      activeTurn.current = null;
      speechQueue.current = Promise.resolve();
      recentSpeech.current.at = Date.now();
      playback.current.stop();
      playback.current.setMuted(muted.current);
      callbacks.current.onEnd();
    }
    status("listening", ar ? "أسمعك — تفضل بسؤالك." : "Listening — go ahead.");
  }
  useLayoutEffect(() => {
    if (callAbort.current && currentState.current !== "opening") {
      review.current?.complete(null);
      captureAbort.current?.abort();
      callbacks.current.onTranscriptPreview("");
      interrupt(); // Discard the previous selection's turn; keep the microphone and socket.
    }
  }, [props.language, props.agent]);
  useImperativeHandle(ref, () => ({
    stop,
    interrupt,
    reset() { stop(); introduced.current.clear(); },
    toggleMute() {
      if (currentState.current === "idle") return;
      muted.current = !muted.current;
      if (muted.current) cues.current?.cancel();
      playback.current.setMuted(muted.current);
      status(currentState.current, statusText.current);
    },
  }));
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    const leave = () => stop();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    window.addEventListener("offline", leave);
    window.addEventListener("sanadi-signing-out", leave);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("offline", leave);
      window.removeEventListener("sanadi-signing-out", leave);
    };
  }, []);

  async function play(wav: ArrayBuffer, text: string, identity: AdvisorIdentity, language: AdvisorLanguage, turn: AbortController, sequence: number,
    delivery: { pauseBeforeMs?: number; rate?: number }) {
    const isCurrent = () => {
      const current = activeTurn.current;
      return current?.controller === turn && turns.current.isCurrent(turn)
        && identity === callbacks.current.agent && current.language === callbacks.current.language
        && language === current.replyLanguage;
    };
    if (!isCurrent()) return;
    await playback.current.play(wav, turn.signal, () => {
      if (!isCurrent()) return;
      const current = activeTurn.current!;
      if (current.inputEndedAt !== undefined && !current.firstPlaybackRecorded && !muted.current) {
        current.firstPlaybackRecorded = true;
        void apiFetch("/api/voice/metrics", { method: "POST", body: JSON.stringify({ type: "first_playback_ms",
          language, turnId: current.id, durationMs: performance.now() - current.inputEndedAt }) }).catch(() => {});
      }
      const greeting = activeTurn.current?.preparedGreeting;
      if (greeting && greeting.text === text) greeting.started = true;
      audibleSequence.current = sequence;
      recentSpeech.current = { text: `${recentSpeech.current.text} ${text}`.slice(-1600), at: Date.now() };
      callbacks.current.onSpeech(text);
      introduced.current.add(identity);
      status("speaking", text);
    }, delivery);
    recentSpeech.current.at = Date.now();
    if (turns.current.isCurrent(turn) && audibleSequence.current === sequence)
      status("processing", ar ? "جارٍ تجهيز الرد…" : "Preparing your reply…");
  }
  function reportError(error: unknown) {
    const code = (error as Error).message;
    const ticketError: Record<string, string> = {
      voice_activity_unavailable: ar ? "تعذر الاتصال بكاشف الكلام على الخادم. تحقق من تشغيل API المحدّث وحاول مجدداً." : "Server speech detection is unavailable. Check that the updated API is running and try again.",
      local_stt_unavailable: ar ? "تعذر تحميل التعرف التلقائي على الكلام. تحقق من الاتصال وحاول مجدداً." : "Automatic speech recognition could not load or finish. Check your connection and try again.",
      stt_unsupported_language: callbacks.current.language === "ar"
        ? "لم أتمكن من فهم التسجيل بالعربية أو الإنجليزية. يرجى إعادة المحاولة."
        : "I couldn't recognize that in English or Arabic. Please try again.",
      voice_audio_protocol_required: ar ? "يرجى تحديث واجهة API لتفعيل صوت الخادم." : "Please rebuild and restart the API to enable server voice replies.",
      voice_audio_unsupported: ar ? "المتصفح لا يدعم تشغيل الصوت." : "This browser does not support audio playback.",
      voice_audio_blocked: ar ? "اضغط الميكروفون للسماح بتشغيل الصوت." : "Click the microphone to allow audio playback.",
      tts_not_configured: ar ? "تحقق من رابط ومفتاح خادم الصوت في إعدادات الذكاء الاصطناعي." : "Check the AI settings URL and API key for speech.",
      tts_auth_failed: ar ? "خادم الصوت رفض مفتاح إعدادات الذكاء الاصطناعي." : "The speech server rejected the AI settings API key.",
      tts_endpoint_missing: ar ? "خدمة الصوت غير متاحة بعد على خادم الذكاء الاصطناعي." : "The AI server's /audio/speech endpoint is not available yet.",
      tts_request_rejected: ar ? "خادم الصوت رفض إعدادات اللغة أو الصوت المحدد." : "The speech server rejected the selected language or voice configuration.",
      tts_invalid_audio: ar ? "خادم الصوت لم يُرجع ملف WAV صالحاً." : "The speech server did not return valid WAV audio.",
      tts_service_unavailable: ar ? "تعذر توليد الصوت على خادم الذكاء الاصطناعي." : "The AI server could not generate speech.",
      voice_call_unavailable: ar ? "تعذر بدء المكالمة. تأكد من تشغيل النسخة المحدثة من API." : "The voice call could not connect. Check that the updated API is running.",
      voice_call_disconnected: ar ? "انقطع اتصال المكالمة. اضغط الميكروفون لبدء مكالمة جديدة." : "The voice call disconnected. Click the microphone to start a new call.",
      voice_browser_protocol_required: ar ? "يرجى تحديث واجهة API لتفعيل الرد الصوتي عبر المتصفح." : "Please rebuild and restart the API to enable browser voice replies.",
      browser_stt_unsupported: ar ? "التعرف على الكلام غير مدعوم في هذا المتصفح. يرجى استخدام متصفح يدعمه أو كتابة سؤالك." : "This browser does not support speech recognition. Use a supported browser or type your question.",
      browser_stt_unavailable: ar ? "تعذر الاتصال بخدمة التعرف على الكلام في المتصفح. تحقق من الاتصال أو اكتب سؤالك." : "Browser speech recognition could not connect. Check your connection or type your question.",
      browser_stt_microphone: ar ? "تعذر الوصول إلى الميكروفون. تحقق من توصيله وإعداداته." : "The microphone could not be accessed. Check its connection and settings.",
      browser_stt_language: ar ? "لغة الكلام المختارة غير مدعومة في هذا المتصفح." : "The selected spoken language is not supported by this browser.",
      stt_audio_unsupported: ar ? "نموذج الذكاء الاصطناعي الحالي لا يدعم إدخال الصوت. يرجى التواصل مع الدعم لتفعيل التعرف على الكلام." : "The configured AI model does not support audio input. Please contact support to enable speech recognition.",
      stt_service_unavailable: ar ? "تعذر التعرف على الكلام عبر خادم الذكاء الاصطناعي. يرجى المحاولة لاحقاً." : "Speech recognition could not complete on the AI server. Please try again later.",
      stt_translation_unavailable: ar ? "تعذر تحويل سؤالك إلى اللغة المختارة. حاول مجدداً أو اكتب سؤالك." : "Your question could not be translated into the selected language. Please try again or type your question.",
      stt_auth_failed: ar ? "خدمة التعرف على الكلام غير متاحة. يرجى التواصل مع الدعم لتحديث بيانات اعتماد الخدمة." : "Speech recognition is unavailable. Please contact support to update the speech service credentials.",
      voice_session_expired: ar ? "انتهت جلسة الدخول. سجّل الدخول مجدداً لاستخدام المحادثة الصوتية." : "Your sign-in session has expired. Please sign in again to use voice chat.",
      voice_access_denied: ar ? "لا تتوفر صلاحية بدء المحادثة الصوتية لهذا الحساب." : "This account does not have access to voice chat.",
      voice_service_busy: ar ? "خدمة الصوت مشغولة حالياً. حاول بعد قليل." : "The voice service is busy. Please try again shortly.",
      voice_ticket_unavailable: ar ? "تعذر بدء جلسة الصوت على الخادم. حاول مجدداً." : "The server could not start a voice session. Please try again.",
      voice_ticket_invalid: ar ? "تعذر بدء جلسة الصوت. حدّث الصفحة وحاول مجدداً." : "The voice session could not start. Refresh the page and try again.",
    };
    if (ticketError[code]) {
      toast.error(ticketError[code]);
      return;
    }
    toast.error((error as Error).name === "NotAllowedError"
      ? (ar ? "اسمح بالميكروفون في إعدادات المتصفح." : "Allow microphone access in your browser settings.")
      : code.startsWith("voice_missing_")
        ? (ar ? "الصوت المطلوب غير متوفر على خادم الصوت." : "The selected voice is unavailable in this language on the speech server.")
        : code === "stt_not_configured"
          ? (ar ? "خدمة التعرف على الكلام غير مهيأة على الخادم." : "Speech recognition is not configured on the server.")
          : (ar ? "تعذر إكمال الرد الصوتي. حاول مجدداً." : "The voice reply could not finish. Please try again."));
  }
  async function microphone() {
    if (props.disabled) return;
    if (callAbort.current) {
      if (currentState.current === "listening") recording.current?.finish();
      else interrupt();
      return;
    }
    stop(true);
    void prompts.current.prepare(callbacks.current.agent, callbacks.current.language);
    const session = new AbortController();
    callAbort.current = session;
    recentSpeech.current = { text: "", at: 0 };
    status("opening", ar ? "جارٍ فتح الميكروفون…" : "Opening microphone…");
    try {
      await playback.current.prepare();
      if (session.signal.aborted) return;
      status("opening", ar ? "جارٍ تجهيز التعرف على الكلام…" : "Preparing speech recognition…");
      const stream = await navigator.mediaDevices.getUserMedia({
        // Avoid requesting automatic gain increases during hands-free listening.
        // A preference, not an exact constraint: unsupported devices must still open.
        // This does not identify the speaker or enforce a microphone distance.
        audio: { echoCancellation: true, noiseSuppression: true,
          autoGainControl: import.meta.env["VITE_VOICE_AUTO_GAIN_CONTROL"] === "true" },
      });
      if (session.signal.aborted) { stream.getTracks().forEach(track => track.stop()); return; }
      microphoneStream.current = stream;
      const microphoneTrack = stream.getAudioTracks()[0];
      if (!microphoneTrack) throw new Error("browser_stt_microphone");
      playback.current.observe(stream);
      await new Promise<void>((resolve, reject) => {
        session.signal.addEventListener("abort", () => resolve(), { once: true });
        const receive = (event: CallEvent) => {
          const turn = activeTurn.current;
          if (!turn || event.turnId !== turn.id || !turns.current.isCurrent(turn.controller)
            || turn.identity !== callbacks.current.agent || turn.language !== callbacks.current.language) return;
          if ((event.type === "result" || event.type === "done") && event.endCall === true) {
            // Once a sign-off is confirmed, stop capture while its farewell finishes.
            // Otherwise loudspeaker/VAD activity can interrupt the pending hang-up.
            turn.ending = true;
            captureAbort.current?.abort();
          }
          if (event.type === "transcript") {
            turn.replyLanguage = event.language;
            callbacks.current.onTranscript(event.text);
            if (turn.preparedGreeting?.started && !turn.preparedGreeting.failed)
              callbacks.current.onSpeech(turn.preparedGreeting.text);
          }
          else if (event.type === "result") {
            void cues.current?.finish();
            if (turn.preparedGreeting)
              turn.preparedGreeting.confirmed = event.response.answer === turn.preparedGreeting.text &&
                event.response.verified === true && event.response.toolsUsed?.includes("greeting") === true;
            callbacks.current.onResult(event.response);
          }
          else if (event.type === "audio") {
            const pendingCue = cues.current?.finish();
            if (event.agent !== turn.identity) { reject(new Error("invalid_voice_identity")); return; }
            if (event.language !== turn.replyLanguage) { reject(new Error("invalid_voice_audio")); return; }
            const prepared = turn.preparedGreeting;
            const playAudio = () => play(event.wav, event.text, turn.identity, turn.replyLanguage, turn.controller, event.sequence, event);
            // Reuse early public greeting playback only after the unchanged backend result confirms it.
            // Failed/missing prepared audio uses the ordinary server WAV; no request is re-executed.
            const queued = prepared && !prepared.failed
              ? prepared.confirmed ? prepared.playback.catch(playAudio) : prepared.playback.catch(() => {}).then(playAudio)
              : pendingCue ? pendingCue.then(playAudio) : playAudio();
            const playing = queued.then(() => {
              if (turns.current.isCurrent(turn.controller)) call.current?.played(turn.id, event.sequence);
            });
            // Keep the existing two-sentence prefetch, after any speech already in progress.
            // play() checks the turn again so an interrupted queue cannot resume later.
            speechQueue.current = Promise.all([speechQueue.current, playing]).then(() => {});
            void speechQueue.current.catch(error => {
              if (turns.current.isCurrent(turn.controller)) reject(error);
            });
          } else if (event.type === "done") {
            const pendingCue = cues.current?.finish();
            const completed = pendingCue ? Promise.all([speechQueue.current, pendingCue]).then(() => {}) : speechQueue.current;
            void finishVoiceTurn(completed, () => turns.current.isCurrent(turn.controller), turn.ending, stop, () => {
              activeTurn.current = null;
              callbacks.current.onEnd();
              status("listening", ar ? "أسمعك — تفضل بسؤالك." : "Listening — go ahead.");
              void prompts.current.prepare(callbacks.current.agent, callbacks.current.language, session.signal);
            }).catch(() => {});
          } else if (event.type === "error") {
            interrupt();
            reportError(new Error(event.error));
          }
        };
        void (async () => {
          const connection = await openVoiceCall(session.signal, receive, reject);
          if (session.signal.aborted) { connection.end(); return; }
          call.current = connection;
          const openingId = crypto.randomUUID();
          const openingLanguage = callbacks.current.language;
          const openingAgent = callbacks.current.agent;
          activeTurn.current = { id: openingId, controller: turns.current.begin(), identity: openingAgent,
            language: openingLanguage, replyLanguage: openingLanguage };
          speechQueue.current = Promise.resolve();
          // Do not replay the introduction in the first answer, even if the student interrupts it.
          introduced.current.add(openingAgent);
          status("processing", ar ? "جارٍ الاتصال..." : "Connecting...");
          const readyWelcome = prompts.current.get(openingAgent, openingLanguage, "welcome")[0];
          if (readyWelcome) {
            const opening = activeTurn.current.controller;
            // The same prepared server WAV starts without another SQL/TTS request or audio transfer.
            const playing = play(readyWelcome.wav.slice(0), readyWelcome.text, openingAgent, openingLanguage, opening, 0, {});
            speechQueue.current = playing;
            void finishVoiceTurn(playing, () => turns.current.isCurrent(opening), false, stop, () => {
              activeTurn.current = null;
              callbacks.current.onEnd();
              status("listening", ar ? "أسمعك — تفضل بسؤالك." : "Listening — go ahead.");
            }).catch(() => {
              if (!turns.current.isCurrent(opening)) return;
              playback.current.stop();
              speechQueue.current = Promise.resolve();
              connection.greet({ turnId: openingId, agent: openingAgent, language: openingLanguage });
            });
          } else connection.greet({ turnId: openingId, agent: openingAgent, language: openingLanguage });
          // Capture starts alongside playback so speech can interrupt the welcome immediately.
          while (!session.signal.aborted) {
            const ending = activeTurn.current?.ending ? activeTurn.current.controller.signal : null;
            if (ending) {
              // End Call or an explicit interruption cancels the turn and releases this wait.
              // Do not open another recording during confirmed farewell playback.
              if (!ending.aborted) await new Promise<void>(resolve => ending.addEventListener("abort", () => resolve(), { once: true }));
              continue;
            }
            const inputLanguage = callbacks.current.language;
            const identity = callbacks.current.agent;
            const captureController = new AbortController();
            const captureIsCurrent = () => !captureController.signal.aborted && captureAbort.current === captureController;
            const cancelCapture = () => captureController.abort();
            captureAbort.current = captureController;
            session.signal.addEventListener("abort", cancelCapture, { once: true });
            let question = "";
            let inputEndedAt: number | undefined;
            let feedback: VoiceFeedbackContext | undefined;
            try {
              const capture = multilingualQuestion(recognition.current, inputLanguage, captureController.signal, () => {
                if (captureIsCurrent() && !activeTurn.current) status("listening", ar ? "أسمعك — توقف قليلاً عند الانتهاء." : "Listening — pause when finished.");
              }, {
                track: microphoneTrack,
                selectedLanguage: inputLanguage,
                isReplying: () => activeTurn.current !== null,
                // Preparation may finish while this capture is listening; ask for recognition metadata now.
                ...(prompts.current.enabled || prompts.current.supportsGreetingReply(identity, inputLanguage)
                  ? { onFeedbackContext: (context: VoiceFeedbackContext) => { feedback = context; } } : {}),
                isEcho: text => (currentState.current === "speaking" || Date.now() - recentSpeech.current.at < 3000)
                  && isVoiceCallEcho(text, recentSpeech.current.text),
                onUserSpeech: () => { if (captureIsCurrent() && activeTurn.current) interrupt(); },
                onPreview: text => {
                  if (captureIsCurrent())
                    callbacks.current.onTranscriptPreview(text);
                },
                onRecognizing: () => {
                  inputEndedAt = performance.now();
                  if (captureIsCurrent() && !activeTurn.current) status("processing", ar ? "جارٍ فهم سؤالك…" : "Understanding your question…");
                },
              });
              recording.current = capture;
              question = await capture.text;
            } catch (error) {
              if (!captureController.signal.aborted) {
                if (error instanceof Error && error.message === "stt_unsupported_language") reportError(error);
                else throw error;
              }
            } finally {
              session.signal.removeEventListener("abort", cancelCapture);
              if (captureAbort.current === captureController) {
                captureAbort.current = null;
                recording.current = null;
              }
            }
            if (session.signal.aborted) break;
            if (activeTurn.current?.ending) continue;
            if (captureController.signal.aborted || inputLanguage !== callbacks.current.language || identity !== callbacks.current.agent) {
              callbacks.current.onTranscriptPreview("");
              continue;
            }
            if (question) {
              if (/\p{N}|\b(reference|course code|student number|date|named|called)\b|رقم|رمز|بتاريخ|اسمه|اسمها/iu.test(question)) {
                interrupt();
                // Human review time is excluded from automatic reply-latency measurements.
                inputEndedAt = undefined;
                void apiFetch("/api/voice/metrics", { method: "POST", body: JSON.stringify({ type: "transcript_review", language: inputLanguage }) }).catch(() => {});
                const reviewed = await new Promise<string | null>(resolve => {
                  review.current = { text: question, complete: value => { review.current = undefined; resolve(value); } };
                  status("reviewing", ar ? "راجع النص قبل الإرسال." : "Review the recognized question before sending.");
                });
                if (session.signal.aborted) break;
                if (!reviewed) { status("listening", null); continue; }
                question = reviewed;
              }
              prompts.current.pause(); // Queue no more optional clips while the actual request runs.
              const controller = turns.current.begin();
              const id = crypto.randomUUID();
              activeTurn.current = { id, controller, identity, language: inputLanguage, replyLanguage: inputLanguage,
                ...(inputEndedAt !== undefined ? { inputEndedAt } : {}) };
              speechQueue.current = Promise.resolve();
              status("processing", ar ? "جارٍ تجهيز الرد…" : "Preparing your reply…");
              callbacks.current.onTranscriptPreview(question);
              cues.current?.start({ enabled: prompts.current.enabled && !muted.current, skip: feedback?.skip !== false,
                signal: controller.signal,
                initial: feedback ? prompts.current.get(identity, feedback.language, "initial") : [],
                waiting: feedback ? prompts.current.get(identity, feedback.language, "waiting") : [] });
              const introduce = !introduced.current.has(identity);
              const greeting = feedback?.greetingReply;
              const readyGreeting = !introduce && feedback?.skip === true && greeting && greeting.language === inputLanguage
                ? prompts.current.get(identity, greeting.language, "greetingReply").find(clip => clip.text === greeting.text) : undefined;
              if (readyGreeting && greeting) {
                const prepared = { text: readyGreeting.text, started: false, failed: false, confirmed: false, playback: Promise.resolve() };
                activeTurn.current.replyLanguage = greeting.language;
                activeTurn.current.preparedGreeting = prepared;
                prepared.playback = play(readyGreeting.wav.slice(0), readyGreeting.text, identity, greeting.language, controller, 0, {});
                speechQueue.current = prepared.playback.catch(() => { prepared.failed = true; });
              }
              connection.turn({ turnId: id, message: question, agent: identity, language: inputLanguage,
                conversationId: callbacks.current.conversationId, introduce });
            } else callbacks.current.onTranscriptPreview("");
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        })().catch(reject);
      });
    } catch (error) {
      if (callAbort.current !== session || session.signal.aborted) return;
      reportError(error);
    } finally {
      if (callAbort.current === session) stop();
    }
  }
  const label = state === "listening"
    ? (ar ? "إنهاء التحدث" : "Finish speaking")
    : state !== "idle" ? (ar ? "مقاطعة الرد والتحدث" : "Interrupt and speak")
      : (ar ? "تحدث إلى سندي" : "Talk to Sanadi");
  return <Button type="button" size="sm" title={label} aria-label={label}
    disabled={props.disabled || state === "opening"} onClick={() => void microphone()}
    className="h-11 shrink-0 gap-2 rounded-full px-4 text-xs font-semibold">
    {state === "listening" ? <Square className="size-4" aria-hidden /> : state === "processing" || state === "opening"
      ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PhoneCall className="size-4" aria-hidden />}
    <span>{label}</span>
  </Button>;
});

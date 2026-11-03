import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneCall, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLiveVoice, type LiveEvent } from "@/hooks/use-live-voice";
import { useAssistantLevel } from "@/lib/assistant-state";
import { getAuthToken } from "@/lib/auth-token";
import { useI18n } from "@/lib/i18n";
import type { AgentResponse } from "@/lib/agent-types";
import { useVoiceSettings, type VoicePersona } from "@/lib/voice-settings";
import meeraAvatar from "@/assets/meera-avatar.jpg";
import suhailAvatar from "@/assets/suhail-avatar.jpg";

const PERSONA_FACES: Record<VoicePersona, string> = { meera: meeraAvatar, suhail: suhailAvatar };

type CallPhase = "listening" | "thinking" | "speaking" | "disconnected" | "connecting";

/**
 * Real-time "Talk to Sanadi" call. Audio flows directly between the browser
 * and the voice service; every request is handed to Sanadi's existing
 * assistant on the server as the signed-in student, in the same conversation.
 */
export function TalkToSanadi({
  conversationId,
  disabled,
  onResponse,
  onActiveChange,
  registerSay,
}: {
  conversationId: string | null;
  disabled?: boolean;
  /** A verified assistant turn produced from speech: render it in the chat. */
  onResponse: (spokenText: string, response: AgentResponse) => void;
  onActiveChange?: (active: boolean) => void;
  /** Lets the page ask Sanadi to speak a verified on-screen result. */
  registerSay?: (say: ((text: string) => void) | null) => void;
}) {
  const { t, lang } = useI18n();
  const ar = lang === "ar";
  const [phase, setPhase] = useState<CallPhase>("disconnected");
  const [caption, setCaption] = useState<{ who: "you" | "sanadi"; text: string } | null>(null);
  const userBuffer = useRef("");
  const convRef = useRef(conversationId);
  convRef.current = conversationId;
  const level = useAssistantLevel();
  const { settings: voicePrefs, update: updateVoicePrefs } = useVoiceSettings();
  const personaRef = useRef<VoicePersona>(voicePrefs.persona);
  personaRef.current = voicePrefs.persona;

  const handleEvent = (event: LiveEvent) => {
    switch (event.type) {
      case "app.connected":
        setPhase("listening");
        break;
      case "session.input_transcript.delta": {
        const delta = String(event["delta"] ?? "");
        userBuffer.current += delta;
        if (voice.audioRef.current?.muted) voice.audioRef.current.muted = false;
        setCaption({ who: "you", text: userBuffer.current.trim().slice(-220) });
        setPhase("listening");
        break;
      }
      case "app.delegation.pending":
        setPhase("thinking");
        break;
      case "session.output_transcript.delta": {
        const delta = String(event["delta"] ?? "");
        setPhase("speaking");
        setCaption((prev) => ({
          who: "sanadi",
          text: ((prev?.who === "sanadi" ? prev.text : "") + delta).slice(-220),
        }));
        break;
      }
      case "app.sanadi.response": {
        const response = event["response"] as AgentResponse | undefined;
        if (response) onResponse(userBuffer.current.replace(/\s+/g, " ").trim(), response);
        userBuffer.current = "";
        break;
      }
      case "app.closed":
        setPhase("disconnected");
        setCaption(null);
        userBuffer.current = "";
        break;
      default:
        break;
    }
  };

  const voice = useLiveVoice({
    onEvent: handleEvent,
    startPayload: () => ({ token: getAuthToken(), conversationId: convRef.current, lang, persona: personaRef.current }),
  });

  const active = voice.status === "connecting" || voice.status === "connected" || voice.status === "stopping";
  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);
  useEffect(() => {
    if (voice.status === "connecting") setPhase("connecting");
  }, [voice.status]);
  useEffect(() => {
    registerSay?.(
      voice.status === "connected"
        ? (text) => voice.sendApp({ type: "app.say", content: `Verified result to tell the student briefly: ${text}` })
        : null,
    );
    return () => registerSay?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.status]);

  const errorText = voice.error
    ? /permission|notallowed|denied/i.test(voice.error)
      ? t("voice_denied")
      : /sign in/i.test(voice.error)
        ? ar
          ? "يرجى تسجيل الدخول مرة أخرى لاستخدام الصوت."
          : "Please sign in again to use voice."
        : ar
          ? "انقطع الاتصال الصوتي. يمكنك المتابعة بالكتابة أو بدء مكالمة جديدة."
          : "The voice connection was lost. You can keep typing or start a new call."
    : null;

  const label =
    phase === "connecting"
      ? ar
        ? "جارٍ الاتصال…"
        : "Connecting…"
      : phase === "listening"
        ? ar
          ? "أستمع إليك"
          : "Listening"
        : phase === "thinking"
          ? ar
            ? "أفكر…"
            : "Thinking…"
          : phase === "speaking"
            ? ar
              ? "يتحدث سندي"
              : "Speaking"
            : ar
              ? "غير متصل"
              : "Disconnected";

  return (
    <div className="mb-2">
      {/* Kept mounted for the whole call, including startup and stopping. */}
      <audio ref={voice.audioRef} className="hidden" />
      {!active ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={voice.start}
            disabled={disabled}
            className="h-11 gap-2 rounded-full px-5"
            aria-label={ar ? "تحدث مع سندي" : "Talk to Sanadi"}
          >
            <PhoneCall className="size-4" aria-hidden />
            {ar ? "تحدث مع سندي" : "Talk to Sanadi"}
          </Button>
          <div
            role="radiogroup"
            aria-label={ar ? "اختر الصوت" : "Choose a voice"}
            className="flex items-center gap-1 rounded-full border bg-card p-1"
          >
            {(
              [
                { id: "meera", en: "Meera", ar: "ميرا", hint: ar ? "صوت أنثوي" : "Female voice" },
                { id: "suhail", en: "Suhail", ar: "سهيل", hint: ar ? "صوت ذكوري" : "Male voice" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={voicePrefs.persona === p.id}
                title={p.hint}
                onClick={() => updateVoicePrefs({ persona: p.id })}
                className={`flex h-9 items-center gap-2 rounded-full pe-3 ps-1 text-xs font-medium transition-colors ${
                  voicePrefs.persona === p.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <img
                  src={PERSONA_FACES[p.id]}
                  alt=""
                  aria-hidden
                  className="size-7 rounded-full border border-border/60 object-cover object-top"
                  loading="lazy"
                />
                {ar ? p.ar : p.en}
                <span className="sr-only"> — {p.hint}</span>
              </button>
            ))}
          </div>
          {errorText ? (
            <span role="alert" className="text-xs text-muted-foreground">
              {errorText}
              {voice.error ? <span className="block opacity-70" dir="ltr">({voice.error})</span> : null}
            </span>
          ) : null}
        </div>
      ) : (
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-3 py-2 card-shadow"
          role="status"
          aria-live="polite"
        >
          <Waveform phase={phase} level={level} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">{label}</p>
            {caption ? (
              <p className="truncate text-xs text-muted-foreground" dir="auto">
                {caption.who === "you" ? (ar ? "أنت: " : "You: ") : ar ? "سندي: " : "Sanadi: "}
                {caption.text}
              </p>
            ) : null}
          </div>
          {voice.playbackBlocked ? (
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={voice.resumePlayback}>
              <Volume2 className="size-4" aria-hidden />
              {ar ? "تشغيل الصوت" : "Play voice"}
            </Button>
          ) : null}
          {phase === "speaking" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9"
              onClick={() => {
                // Silence the current reply and go back to listening; the
                // student's next words un-silence Sanadi automatically.
                if (voice.audioRef.current) voice.audioRef.current.muted = true;
                setPhase("listening");
              }}
            >
              {ar ? "مقاطعة" : "Interrupt"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 gap-1"
            disabled={voice.status !== "connected"}
            onClick={() => voice.setMuted(!voice.muted)}
          >
            {voice.muted ? <Mic className="size-4" aria-hidden /> : <MicOff className="size-4" aria-hidden />}
            {voice.muted ? t("voice_unmute") : t("voice_mute")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-9 gap-1"
            disabled={voice.status === "stopping"}
            onClick={voice.stop}
          >
            <PhoneOff className="size-4" aria-hidden />
            {ar ? "إنهاء المكالمة" : "End call"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Animated waveform: livelier while speaking or listening. */
function Waveform({ phase, level }: { phase: CallPhase; level: number }) {
  const moving = phase === "listening" || phase === "speaking" || phase === "thinking";
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {[0.5, 0.9, 0.65, 1, 0.7, 0.85, 0.55].map((h, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-primary ${moving ? "animate-pulse" : "opacity-40"}`}
          style={{
            height: `${Math.round(8 + (phase === "speaking" ? 20 : phase === "listening" ? 12 + level * 10 : 6) * h)}px`,
            animationDelay: `${i * 110}ms`,
            animationDuration: phase === "thinking" ? "1.6s" : "0.9s",
          }}
        />
      ))}
    </div>
  );
}

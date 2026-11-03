import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Mic, Pencil, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { setAssistantLevel, setAssistantState } from "@/lib/assistant-state";
import { useI18n } from "@/lib/i18n";
import { useVoiceSettings } from "@/lib/voice-settings";
import { transcribeVoice } from "@/lib/voice.functions";
import { needsVoiceConfirmation, voiceConfirmationPrompt } from "@/lib/voice/normalize";

export type VoiceMeta = {
  language: "en" | "ar";
  reshaped: number;
  confirmed: boolean;
  transcribedAt: string;
};

/**
 * Microphone control for the existing chat composer. It only produces text:
 * the transcript is handed back to the caller for review before sending, so a
 * spoken message travels through exactly the same assistant workflow as a
 * typed one. Audio never leaves memory and is never persisted.
 */
export function VoiceInput({
  disabled,
  onTranscript,
  conversationId,
  forceAutoSend,
  startSignal,
}: {
  disabled?: boolean;
  onTranscript: (text: string, autoSend: boolean, meta: VoiceMeta) => void;
  conversationId?: string | null;
  /** Voice conversation mode sends without waiting for review. */
  forceAutoSend?: boolean;
  /** Incrementing this starts listening (voice conversation mode). */
  startSignal?: number;
}) {
  const { t, lang } = useI18n();
  const { settings, update } = useVoiceSettings();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [pending, setPending] = useState<{ text: string; meta: VoiceMeta; prompt: string } | null>(null);

  const recorder = useVoiceRecorder({
    onDenied: () => setError(t("voice_denied")),
    onUnavailable: () => setError(t("voice_unsupported")),
    onRecorded: async (audioBase64) => {
      try {
        const result = await transcribeVoice({
          data: { audioBase64, language: settings.language, conversationId: conversationId ?? null },
        });
        const text = result.text.trim();
        if (!text) {
          setError(t("voice_no_speech"));
          return;
        }
        setError(null);
        const meta: VoiceMeta = {
          language: result.language,
          reshaped: result.reshaped.length,
          confirmed: false,
          transcribedAt: new Date().toISOString(),
        };
        const autoSend = settings.autoSend || Boolean(forceAutoSend);
        if (needsVoiceConfirmation(result.reshaped)) {
          // Put the text in the box but hold sending until the reshaped
          // reference or course code is confirmed.
          onTranscript(text, false, meta);
          setPending({ text, meta, prompt: voiceConfirmationPrompt(result.reshaped, lang === "ar" ? "ar" : "en") });
          return;
        }
        onTranscript(text, autoSend, meta);
      } catch {
        setError(t("voice_failed"));
      }
    },
  });

  const listening = recorder.state === "listening";
  const processing = recorder.state === "processing";

  // Keep the Sanadi avatar in sync with the microphone lifecycle.
  useEffect(() => {
    setAssistantState(listening ? "listening" : processing ? "thinking" : "idle");
    return () => setAssistantState("idle");
  }, [listening, processing]);

  useEffect(() => {
    if (listening) setAssistantLevel(recorder.level);
  }, [listening, recorder.level]);

  const startListening = () => {
    setError(null);
    setPending(null);
    if (!settings.privacyAck) {
      setNotice(true);
      return;
    }
    void recorder.start();
  };

  const lastSignal = useRef(startSignal ?? 0);
  useEffect(() => {
    if (startSignal === undefined || startSignal === lastSignal.current) return;
    lastSignal.current = startSignal;
    if (recorder.state !== "listening" && recorder.state !== "processing") startListening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  if (!settings.enabled) return null;

  if (notice) {
    return (
      <div role="dialog" aria-label={t("voice_notice_title")} className="flex flex-1 flex-wrap items-center gap-2 px-2 py-1">
        <span className="text-xs text-muted-foreground">{t("voice_notice")}</span>
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={() => {
            update({ privacyAck: true });
            setNotice(false);
            void recorder.start();
          }}
        >
          {t("voice_notice_ok")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setNotice(false)}>
          {t("voice_cancel")}
        </Button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2 px-2 py-1" role="status">
        <span className="text-xs font-medium">{pending.prompt}</span>
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1"
          onClick={() => {
            const p = pending;
            setPending(null);
            onTranscript(p.text, true, { ...p.meta, confirmed: true });
          }}
        >
          <Check className="size-3" aria-hidden />
          {t("voice_confirm_yes")}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={() => setPending(null)}>
          <Pencil className="size-3" aria-hidden />
          {t("voice_confirm_edit")}
        </Button>
      </div>
    );
  }

  // Error state: a plain message the student can retry or dismiss. Typing is
  // never blocked while it is shown.
  if (error) {
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2 px-2 py-1">
        <span className="text-xs text-muted-foreground">{error}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1"
          onClick={startListening}
        >
          <RotateCcw className="size-3" aria-hidden />
          {t("voice_retry")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8"
          aria-label={t("voice_dismiss")}
          onClick={() => setError(null)}
        >
          <X className="size-3" aria-hidden />
        </Button>
      </div>
    );
  }

  if (listening) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="hidden sm:inline">{t("voice_listening")}</span>
          <span className="tabular-nums">
            {String(Math.floor(recorder.seconds / 60)).padStart(2, "0")}:
            {String(recorder.seconds % 60).padStart(2, "0")}
          </span>
        </span>
        <div className="flex h-5 items-end gap-[3px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-primary transition-all duration-100"
              style={{
                height: `${Math.max(4, Math.min(20, recorder.level * 20 * (i % 2 === 0 ? 1 : 0.65) + 4))}px`,
              }}
            />
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="default"
          aria-label={lang === "ar" ? "إيقاف التسجيل" : "Stop recording"}
          onClick={recorder.stop}
          className="h-10 min-w-11 gap-1"
        >
          <Square className="size-3" aria-hidden />
          {t("voice_stop")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={t("voice_cancel")}
          onClick={recorder.cancel}
          className="h-10 min-w-11 gap-1"
        >
          <X className="size-3" aria-hidden />
          <span className="hidden sm:inline">{t("voice_cancel")}</span>
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={processing ? t("voice_processing") : t("voice_input")}
      aria-label={processing ? t("voice_processing") : lang === "ar" ? "بدء الإدخال الصوتي" : "Start voice input"}
      disabled={disabled || processing}
      onClick={startListening}
      className="size-11 shrink-0"
    >
      {processing ? (
        <Loader2 className="size-5 animate-spin" aria-hidden />
      ) : (
        <Mic className="size-5" aria-hidden />
      )}
    </Button>
  );
}

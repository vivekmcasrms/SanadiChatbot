import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { setAssistantLevel, setAssistantState } from "@/lib/assistant-state";
import { apiFetch } from "@/lib/auth-token";
import { useI18n } from "@/lib/i18n";
import { useVoiceSettings, type VoiceLanguagePref } from "@/lib/voice-settings";
import { recognizerLanguageMismatch } from "@/lib/voice-agent";
import {
  acknowledgeVoicePrivacy,
  hasAcknowledgedVoicePrivacy,
  recordVoiceMetric,
} from "@/lib/voice-channel";
import { toast } from "sonner";

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: BrowserSpeechResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence: number };
  }>;
};

function speechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

/** Resolve STT locale from the spoken text — never from the OS / browser language. */
function speechLangFromSpeech(pref: VoiceLanguagePref, spoken: string): string {
  if (pref === "ar") return "ar-AE";
  if (pref === "en") return "en-US";
  if (hasArabic(spoken) && !hasLatin(spoken)) return "ar-AE";
  if (hasLatin(spoken) && !hasArabic(spoken)) return "en-US";
  if (hasArabic(spoken) && hasLatin(spoken)) {
    const ar = (spoken.match(/[\u0600-\u06FF]/g) ?? []).length;
    const en = (spoken.match(/[A-Za-z]/g) ?? []).length;
    return ar >= en ? "ar-AE" : "en-US";
  }
  return "en-US";
}

/**
 * Microphone control for the chat composer.
 *
 * Always captures WAV for production server STT, and optionally uses the
 * browser Speech Recognition API for live interim text when it works.
 * Transcripts are placed in the editable composer (Phase 1) unless auto-send
 * / continuous mode is enabled.
 */
export function VoiceInput({
  disabled,
  composeText = "",
  onTranscript,
  startSignal = 0,
  stopSignal = 0,
  forceAutoSend = false,
  onSpeechActivity,
  onCancel,
  preferredLang = null,
  onLanguageMismatch,
}: {
  disabled?: boolean;
  composeText?: string;
  onTranscript: (text: string, autoSend: boolean, confidence?: number | null) => void;
  startSignal?: number;
  stopSignal?: number;
  forceAutoSend?: boolean;
  onSpeechActivity?: (spoken: string) => void;
  onCancel?: () => void;
  preferredLang?: "en" | "ar" | null;
  onLanguageMismatch?: (lang: "en" | "ar", spoken: string) => void;
}) {
  const { t } = useI18n();
  const { settings } = useVoiceSettings();
  const [error, setError] = useState<string | null>(null);
  const [listeningLive, setListeningLive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [awaitingServer, setAwaitingServer] = useState(false);

  const prefixRef = useRef("");
  const finalsRef = useRef("");
  const latestTranscriptRef = useRef("");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSessionActiveRef = useRef(false);
  const recorderSpeechStartedRef = useRef(false);
  const recorderLastSpeechAtRef = useRef(0);
  const stoppingRef = useRef(false);
  const liveActiveRef = useRef(false);
  const langSwitchRef = useRef(false);
  const activeSpeechLangRef = useRef("en-US");
  const finalConfidencesRef = useRef<number[]>([]);
  const languageRetryRef = useRef(false);
  const preferBrowserTranscriptRef = useRef(false);

  const clearTimers = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    setSeconds(0);
    setLevel(0);
  };

  const emitFinal = (spoken: string, autoSend: boolean, confidence: number | null) => {
    const text = spoken.trim();
    if (!text) {
      void recordVoiceMetric({ type: "transcription_fail" });
      setError(t("voice_no_speech"));
      return;
    }
    if (autoSend && onLanguageMismatch && settings.language === "auto" && !languageRetryRef.current) {
      const active = activeSpeechLangRef.current.startsWith("ar") ? "ar" : "en";
      const target = recognizerLanguageMismatch(text, active, confidence);
      if (target) {
        languageRetryRef.current = true;
        activeSpeechLangRef.current = target === "ar" ? "ar-AE" : "en-US";
        onLanguageMismatch(target, text);
        return;
      }
    }
    languageRetryRef.current = false;
    const prefix = prefixRef.current;
    void recordVoiceMetric({
      type: "transcription_ok",
      language: activeSpeechLangRef.current.startsWith("ar") ? "ar" : "en",
    });
    onTranscript(prefix ? `${prefix}${text}` : text, autoSend, confidence);
  };

  const recorder = useVoiceRecorder({
    onDenied: () => setError(t("voice_denied")),
    onUnavailable: () => setError(t("voice_unsupported")),
    onEmpty: () => {
      setAwaitingServer(false);
      if (preferBrowserTranscriptRef.current) return;
      void recordVoiceMetric({ type: "transcription_fail" });
      setError(t("voice_no_speech"));
    },
    onRecorded: async (audioBase64) => {
      // Browser already produced a usable transcript — discard the WAV.
      if (preferBrowserTranscriptRef.current) {
        preferBrowserTranscriptRef.current = false;
        setAwaitingServer(false);
        return;
      }
      setAwaitingServer(true);
      try {
        const result = await apiFetch<{ text: string; confidence?: number | null }>("/api/voice/transcribe", {
          method: "POST",
          body: JSON.stringify({ audioBase64, language: settings.language }),
        });
        const text = (result.text ?? "").trim();
        if (!text) {
          void recordVoiceMetric({ type: "transcription_fail" });
          setError(t("voice_no_speech"));
          return;
        }
        setError(null);
        const conf =
          typeof result.confidence === "number" && Number.isFinite(result.confidence)
            ? result.confidence
            : null;
        // Only continuous mode passes forceAutoSend; Phase 1 always leaves text in the composer.
        emitFinal(text, forceAutoSend, conf);
      } catch {
        void recordVoiceMetric({ type: "transcription_fail" });
        void recordVoiceMetric({ type: "speech_service_fail" });
        setError(t("voice_failed"));
      } finally {
        setAwaitingServer(false);
      }
    },
  });

  const listening = listeningLive || recorder.state === "listening";
  const processing = !listeningLive && (recorder.state === "processing" || awaitingServer);

  useEffect(() => {
    if (recorder.state !== "listening" || !forceAutoSend) {
      recorderSpeechStartedRef.current = false;
      recorderLastSpeechAtRef.current = 0;
      return;
    }
    if (recorder.level >= 0.12) {
      recorderSpeechStartedRef.current = true;
      recorderLastSpeechAtRef.current = Date.now();
      return;
    }
    if (recorderSpeechStartedRef.current && Date.now() - recorderLastSpeechAtRef.current >= 1200) {
      recorderSpeechStartedRef.current = false;
      finishCapture(true);
    }
  }, [forceAutoSend, recorder.level, recorder.state]);

  useEffect(() => {
    setAssistantState(listening ? "listening" : processing ? "thinking" : "idle");
    return () => setAssistantState("idle");
  }, [listening, processing]);

  useEffect(() => {
    if (listening) setAssistantLevel(listeningLive ? level : recorder.level);
  }, [listening, listeningLive, level, recorder.level]);

  useEffect(
    () => () => {
      clearTimers();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (startSignal > 0 && !disabled) {
      voiceSessionActiveRef.current = true;
      if (!listeningLive && recorder.state !== "listening") startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  useEffect(() => {
    if (stopSignal > 0) {
      voiceSessionActiveRef.current = false;
      if (listening) finishCapture(false);
      else if (recorder.state === "processing") recorder.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSignal]);

  if (!settings.enabled && !forceAutoSend) return null;

  const abortBrowserRecognition = () => {
    stoppingRef.current = true;
    liveActiveRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setListeningLive(false);
  };

  const averageConfidence = (): number | null => {
    const measured = finalConfidencesRef.current.filter((value) => Number.isFinite(value) && value > 0);
    finalConfidencesRef.current = [];
    return measured.length ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null;
  };

  /** Stop listening and prefer browser transcript; otherwise finish WAV → server STT. */
  const finishCapture = (autoSend: boolean) => {
    voiceSessionActiveRef.current = false;
    clearTimers();
    const browserSpoken = (latestTranscriptRef.current || finalsRef.current).trim();
    const confidence = averageConfidence();

    abortBrowserRecognition();

    if (browserSpoken) {
      preferBrowserTranscriptRef.current = true;
      if (recorder.state === "listening" || recorder.state === "processing") recorder.cancel();
      emitFinal(browserSpoken, autoSend, confidence);
      return;
    }

    // No browser transcript — upload the WAV for production STT.
    preferBrowserTranscriptRef.current = false;
    if (recorder.state === "listening") {
      setAwaitingServer(true);
      recorder.stop();
      return;
    }
    void recordVoiceMetric({ type: "transcription_fail" });
    setError(t("voice_no_speech"));
  };

  const startLive = (): boolean => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return false;
    const recognition = new Ctor();
    const initialLang =
      settings.language === "auto" && preferredLang
        ? preferredLang === "ar"
          ? "ar-AE"
          : "en-US"
        : speechLangFromSpeech(settings.language, "");
    activeSpeechLangRef.current = initialLang;
    recognition.lang = initialLang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    finalsRef.current = "";
    latestTranscriptRef.current = "";
    finalConfidencesRef.current = [];
    stoppingRef.current = false;
    langSwitchRef.current = false;
    liveActiveRef.current = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (!liveActiveRef.current) return;
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i];
        if (!piece) continue;
        const said = piece[0]?.transcript ?? "";
        if (piece.isFinal) {
          finalConfidencesRef.current.push(Number(piece[0]?.confidence));
          finalsRef.current = `${finalsRef.current}${said}`.replace(/\s+/g, " ");
          if (!finalsRef.current.endsWith(" ")) finalsRef.current += " ";
        } else {
          interim += said;
        }
      }
      const spoken = `${finalsRef.current}${interim}`.trimStart();
      latestTranscriptRef.current = spoken.trim();
      const prefix = prefixRef.current;
      onTranscript(prefix ? `${prefix}${spoken}` : spoken, false);
      if (spoken.trim()) onSpeechActivity?.(spoken.trim());
      setLevel((prev) => Math.min(1, Math.max(0.35, prev * 0.6 + 0.45)));
      if (forceAutoSend && spoken.trim()) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => finishCapture(true), 1100);
      }

      if (settings.language === "auto" && spoken.trim()) {
        const nextLang = speechLangFromSpeech("auto", spoken);
        if (nextLang !== activeSpeechLangRef.current && recognitionRef.current) {
          activeSpeechLangRef.current = nextLang;
          recognitionRef.current.lang = nextLang;
          langSwitchRef.current = true;
          try {
            recognitionRef.current.stop();
          } catch {
            /* ignore */
          }
        }
      }
    };

    recognition.onerror = (event) => {
      const code = event.error ?? "";
      if (code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        // Keep WAV capture running — server STT can still work with mic permission.
        liveActiveRef.current = false;
        setListeningLive(false);
        return;
      }
      // Browser STT is unreliable in some embedded browsers; WAV capture continues.
      liveActiveRef.current = false;
      setListeningLive(false);
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      if (!stoppingRef.current && liveActiveRef.current) {
        try {
          langSwitchRef.current = false;
          recognition.lang = activeSpeechLangRef.current;
          recognition.start();
          return;
        } catch {
          /* fall through — WAV recorder remains the source of truth */
        }
      }
      liveActiveRef.current = false;
      setListeningLive(false);
    };

    try {
      recognition.start();
    } catch {
      liveActiveRef.current = false;
      return false;
    }

    setListeningLive(true);
    return true;
  };

  const startListening = () => {
    setError(null);
    if (!hasAcknowledgedVoicePrivacy()) {
      acknowledgeVoicePrivacy();
      toast.message(t("voice_privacy_note"));
    }
    voiceSessionActiveRef.current = true;
    preferBrowserTranscriptRef.current = false;
    setAwaitingServer(false);
    const trimmed = composeText.trim();
    prefixRef.current = trimmed ? `${trimmed} ` : "";
    finalsRef.current = "";
    latestTranscriptRef.current = "";
    void recordVoiceMetric({
      type: "voice_interaction",
      language: settings.language === "auto" ? "auto" : settings.language,
    });

    // Always capture WAV for production STT; browser STT is best-effort for live text.
    void (async () => {
      await recorder.start();
      startLive();
    })();

    setSeconds(0);
    setLevel(0.4);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        if (next >= 90) finishCapture(forceAutoSend);
        return next;
      });
    }, 1000);
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    levelTimerRef.current = setInterval(() => {
      setLevel((prev) => Math.max(0.15, prev * 0.85));
    }, 120);
  };

  if (error) {
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2 px-2 py-1">
        <span className="text-xs text-muted-foreground">{error}</span>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1" onClick={startListening}>
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

  if (listening || processing) {
    if (processing) {
      return (
        <div className="flex flex-1 items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("voice_processing")}
        </div>
      );
    }
    const displaySeconds = listeningLive ? seconds : recorder.seconds;
    const displayLevel = Math.max(level, recorder.level);
    return (
      <div className="flex flex-1 items-center gap-2">
        <span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-2 animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <span className="hidden sm:inline">{t("voice_listening")}</span>
          <span className="tabular-nums">
            {String(Math.floor(displaySeconds / 60)).padStart(2, "0")}:
            {String(displaySeconds % 60).padStart(2, "0")}
          </span>
        </span>
        <div className="flex h-5 items-end gap-[3px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-primary transition-all duration-100"
              style={{
                height: `${Math.max(4, Math.min(20, displayLevel * 20 * (i % 2 === 0 ? 1 : 0.65) + 4))}px`,
              }}
            />
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="default"
          aria-label={t("voice_stop")}
          onClick={() => finishCapture(forceAutoSend)}
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
          onClick={() => {
            onCancel?.();
            voiceSessionActiveRef.current = false;
            preferBrowserTranscriptRef.current = true;
            clearTimers();
            abortBrowserRecognition();
            recorder.cancel();
            onTranscript(prefixRef.current.trimEnd(), false);
            setError(null);
          }}
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
      title={t("voice_input")}
      aria-label={t("voice_input")}
      disabled={disabled}
      onClick={startListening}
      className="size-11 shrink-0"
    >
      <Mic className="size-5" aria-hidden />
    </Button>
  );
}

/**
 * Optional continuous voice conversation mode.
 *
 * Boundary with the text chat window (routes/_authenticated/assistant.tsx):
 * - Every turn is submitted through the parent's send()/streamAssistant path.
 * - No separate voice agents, no /api/voice/chat/ask, no local intent routing.
 * - TTS is optional playback of the streamed answer when autoSpeak is on.
 */
import { useEffect, useRef, useState } from "react";
import { VoiceInput } from "@/components/VoiceInput";
import type { AgentResponse } from "@/lib/agent-types";
import { forSpeakingHighlights } from "@/lib/voice-agent";
import { arabicSpeechAvailable, speakArabic, warmArabicSpeech, type ArabicPlayback } from "@/lib/voice-arabic-tts";
import {
  acknowledgeVoicePrivacy,
  hasAcknowledgedVoicePrivacy,
  recordVoiceMetric,
  voiceTranscriptLanguage,
} from "@/lib/voice-channel";
import { assistantEchoWordCount, preferredSpeechVoice, speechWords } from "@/lib/voice-speech";
import { readVoiceSettings } from "@/lib/voice-settings";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export function VoiceConversation({
  composeText,
  supportAgent,
  uiLanguage,
  isWindowBusy,
  onSubmitTranscript,
  onSpeakAnswer,
}: {
  composeText: string;
  supportAgent: "mira" | "suhail";
  uiLanguage: "en" | "ar";
  isWindowBusy: () => boolean;
  /** Same path as typed Send: returns the streamed AgentResponse when done. */
  onSubmitTranscript: (text: string, language: "en" | "ar") => Promise<AgentResponse | null>;
  /** Optional: parent can speak using its Listen helper; fallback is local TTS. */
  onSpeakAnswer?: (text: string, language: "en" | "ar") => void;
}) {
  const { t } = useI18n();
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [listenSignal, setListenSignal] = useState(0);
  const currentlySpokenTextRef = useRef("");
  const interruptedSpeechRef = useRef(false);
  const busyRef = useRef(false);
  const sessionRef = useRef(false);
  const languageRef = useRef<"en" | "ar" | null>(null);
  const turnRef = useRef(0);
  const arabicPlaybackRef = useRef<ArabicPlayback | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const warm = () => {
      window.speechSynthesis.getVoices();
    };
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  function cancelSpeech() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    arabicPlaybackRef.current?.stop();
    arabicPlaybackRef.current = null;
  }

  function queueArabicFallback(text: string, agent: "mira" | "suhail", onDone?: () => void): boolean {
    let finished = false;
    const finishSpeaking = () => {
      if (finished) return;
      finished = true;
      arabicPlaybackRef.current = null;
      setAssistantSpeaking(false);
      if (!interruptedSpeechRef.current) currentlySpokenTextRef.current = "";
      onDone?.();
    };
    arabicPlaybackRef.current = speakArabic(
      text,
      {
        onStart: () => {
          interruptedSpeechRef.current = false;
          currentlySpokenTextRef.current = text;
          setAssistantSpeaking(true);
        },
        onEnd: finishSpeaking,
      },
      agent,
    );
    return true;
  }

  function queueSpeech(text: string, language: "en" | "ar", agent: "mira" | "suhail", onDone?: () => void): boolean {
    try {
      if (!text.trim() || typeof window === "undefined") return false;
      // Arabic: always use cloud/Piper — system speechSynthesis is silent on most PCs.
      if (language === "ar" && arabicSpeechAvailable()) {
        return queueArabicFallback(text, agent, onDone);
      }
      if (!("speechSynthesis" in window)) {
        return language === "ar" && arabicSpeechAvailable() ? queueArabicFallback(text, agent, onDone) : false;
      }
      if (onSpeakAnswer) {
        onSpeakAnswer(text, language);
        onDone?.();
        return true;
      }
      const voices = window.speechSynthesis.getVoices();
      const voice = preferredSpeechVoice(voices, language, agent);
      if (language === "ar" && !voice) {
        return arabicSpeechAvailable() ? queueArabicFallback(text, agent, onDone) : false;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.lang = language === "ar" ? "ar-AE" : "en-AE";
      utterance.rate = 1.02;
      utterance.pitch = 1;
      let finished = false;
      const finishSpeaking = () => {
        if (finished) return;
        finished = true;
        setAssistantSpeaking(false);
        if (!interruptedSpeechRef.current) currentlySpokenTextRef.current = "";
        onDone?.();
      };
      utterance.onstart = () => {
        interruptedSpeechRef.current = false;
        currentlySpokenTextRef.current = text;
        setAssistantSpeaking(true);
      };
      utterance.onend = finishSpeaking;
      utterance.onerror = () => {
        if (language === "ar" && arabicSpeechAvailable() && !finished) {
          queueArabicFallback(text, agent, onDone);
          return;
        }
        finishSpeaking();
      };
      window.speechSynthesis.speak(utterance);
      window.speechSynthesis.resume();
      return true;
    } catch {
      return language === "ar" && arabicSpeechAvailable() ? queueArabicFallback(text, agent, onDone) : false;
    }
  }

  function speakThenListen(reply: string, language: "en" | "ar", agent: "mira" | "suhail", keepListening: boolean) {
    const continueListening = () => {
      if (!keepListening || !sessionRef.current) return;
      setListenSignal((current) => current + 1);
    };
    const settings = readVoiceSettings();
    if (!settings.autoSpeak) {
      busyRef.current = false;
      setVoiceProcessing(false);
      continueListening();
      return;
    }
    const started = queueSpeech(reply, language, agent, continueListening);
    busyRef.current = false;
    setVoiceProcessing(false);
    if (!started) continueListening();
  }

  async function sendVoice(text: string, selectedAgent: "mira" | "suhail") {
    const spokenText = text.trim();
    if (!spokenText || busyRef.current || isWindowBusy()) return;
    if (!hasAcknowledgedVoicePrivacy()) {
      acknowledgeVoicePrivacy();
      toast.message(t("voice_privacy_note"));
    }
    busyRef.current = true;
    sessionRef.current = true;
    setVoiceProcessing(true);
    const turnLang = voiceTranscriptLanguage(spokenText, languageRef.current);
    languageRef.current = turnLang;
    if (turnLang === "ar") warmArabicSpeech();
    const turnId = turnRef.current + 1;
    turnRef.current = turnId;
    cancelSpeech();
    void recordVoiceMetric({ type: "voice_interaction", language: turnLang });

    try {
      const response = await onSubmitTranscript(spokenText, turnLang);
      if (turnId !== turnRef.current || !sessionRef.current) {
        busyRef.current = false;
        setVoiceProcessing(false);
        return;
      }
      const answer = response?.answer?.trim() ?? "";
      // Speak in the language of the reply text (Arabic question → Arabic TTS).
      const replyLang = answer
        ? voiceTranscriptLanguage(answer, turnLang)
        : turnLang;
      languageRef.current = replyLang;
      if (response?.proposedActions?.length || response?.responseType === "action_proposal") {
        sessionRef.current = false;
        speakThenListen(
          replyLang === "ar"
            ? "وضعت لك خيارات التقديم في نافذة المحادثة. راجعها وأكّد من هناك."
            : "I've placed the submission options in the chat window. Please review and confirm them there.",
          replyLang,
          selectedAgent,
          false,
        );
        void recordVoiceMetric({ type: "voice_action_completed", language: replyLang });
        return;
      }
      const spoken = forSpeakingHighlights(
        answer || (replyLang === "ar" ? "ما سمعت زين. تعيد؟" : "I didn't quite catch that. Could you say it again?"),
        replyLang,
      );
      speakThenListen(spoken, replyLang, selectedAgent, true);
      void recordVoiceMetric({ type: "transcription_ok", language: replyLang });
    } catch {
      if (turnId !== turnRef.current) return;
      void recordVoiceMetric({ type: "speech_service_fail", language: turnLang });
      const retry =
        turnLang === "ar"
          ? "عذراً، انقطع ذلك. أعد الطلب من فضلك."
          : "Sorry, that was interrupted. Please say the request again.";
      speakThenListen(retry, turnLang, selectedAgent, true);
    }
  }

  return (
    <VoiceInput
      disabled={voiceProcessing}
      composeText={composeText}
      forceAutoSend
      startSignal={listenSignal}
      preferredLang={languageRef.current ?? uiLanguage}
      onLanguageMismatch={(target) => {
        languageRef.current = target;
        sessionRef.current = true;
        cancelSpeech();
        speakThenListen(
          target === "ar"
            ? "لم ألتقط ذلك بوضوح. تفضل بالعربي، أنا أسمعك."
            : "I didn't quite catch that. Please go ahead in English, I'm listening.",
          target,
          supportAgent,
          true,
        );
      }}
      onCancel={() => {
        sessionRef.current = false;
        cancelSpeech();
      }}
      onSpeechActivity={(spoken) => {
        if (!assistantSpeaking || !currentlySpokenTextRef.current) return;
        const heardWords = speechWords(spoken);
        const echoWords = assistantEchoWordCount(spoken, currentlySpokenTextRef.current);
        if (echoWords === heardWords.length && heardWords.length <= 2) return;
        if (echoWords >= 2 && heardWords.length - echoWords <= 1) return;
        interruptedSpeechRef.current = true;
        setAssistantSpeaking(false);
        cancelSpeech();
      }}
      onTranscript={(text, autoSend) => {
        if (!autoSend) return;
        const request = text.trim();
        if (request) void sendVoice(request, supportAgent);
      }}
    />
  );
}

import { getActiveRoles } from "@/lib/authz/roles.server";
import { ttsArabicSteer } from "@/lib/arabic/emirati";
import { voiceArabicStyleNow } from "@/lib/agent/settings.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  VOICE_VOCABULARY,
  detectSpokenLanguage,
  normalizeTranscript,
  speakableText,
  type ReshapedItem,
} from "@/lib/voice/normalize";

const Input = z.object({
  /** base64-encoded 16 kHz mono WAV, kept in memory only. */
  audioBase64: z.string().min(64).max(14_000_000),
  /** "auto" lets the model detect Arabic / English / mixed speech. */
  language: z.enum(["auto", "en", "ar"]).default("auto"),
  conversationId: z.string().uuid().nullable().optional(),
});

export type VoiceTranscription = {
  text: string;
  language: "en" | "ar";
  reshaped: ReshapedItem[];
};

async function logVoiceFailure(userId: string, conversationId: string | null, detail: string) {
  try {
    const { logException } = await import("@/lib/exceptions/handle.server");
    await logException("api_failure", {
      userId,
      conversationId,
      detail,
      context: { channel: "voice", stage: "transcription" },
      recovered: true,
      recoveryAction: "student_offered_retry_or_typing",
    });
  } catch {
    /* logging must never block the student */
  }
}

/**
 * Server-side speech-to-text. Audio is streamed to the provider in memory and
 * never persisted; only the cleaned transcript reaches the client.
 */
export const transcribeVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<VoiceTranscription> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Speech-to-text is not configured.");

    const bytes = Buffer.from(data.audioBase64, "base64");
    if (bytes.byteLength < 2048) throw new Error("empty_recording");
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("recording_too_long");

    const call = async (model: string) => {
      const form = new FormData();
      form.append("model", model);
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
        "recording.wav",
      );
      // Omitting `language` keeps auto-detection on for mixed speech.
      if (data.language !== "auto") form.append("language", data.language);
      // Vocabulary hint for university terms, course codes and references.
      form.append("prompt", `UAEU student services in the UAE. Speakers often use Emirati Arabic (شو، أبغي، مب، وين، سو لي، شوف لي، الحين، اللي) and mix Arabic with English words. Terms: ${VOICE_VOCABULARY.join(", ")}.`);

      return fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    };

    let response = await call("google/gemini-3.5-transcribe");
    if (response.status >= 500 || response.status === 400) {
      const first = await response.text().catch(() => "");
      console.error(`Transcription failed [${response.status}]: ${first}`);
      response = await call("openai/gpt-4o-mini-transcribe");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Transcription failed [${response.status}]: ${body}`);
      await logVoiceFailure(context.userId, data.conversationId ?? null, `status ${response.status}`);
      if (response.status === 429) throw new Error("rate_limited");
      if (response.status === 402) throw new Error("out_of_credits");
      if (response.status === 403) throw new Error("voice_unavailable");
      throw new Error(`transcription_failed_${response.status}`);
    }

    const json = (await response.json()) as { text?: string };
    const normalized = normalizeTranscript((json.text ?? "").trim());
    return {
      text: normalized.text,
      language: detectSpokenLanguage(normalized.text),
      reshaped: normalized.reshaped,
    };
  });

const SpeakInput = z.object({
  text: z.string().min(1).max(8000),
  lang: z.enum(["en", "ar"]),
  persona: z.enum(["meera", "suhail"]).default("meera"),
});

/**
 * Reads an assistant reply aloud. Only the visible answer text is spoken;
 * links, references and markup are removed first. Audio is returned to the
 * browser in memory and never stored.
 */
export const speakText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SpeakInput.parse(input))
  .handler(async ({ data, context }): Promise<{ audioBase64: string; mime: string }> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Speech is not configured.");
    const text = speakableText(data.text);
    if (!text) throw new Error("nothing_to_speak");

    const steer =
      data.lang === "ar"
        ? `${ttsArabicSteer(voiceArabicStyleNow())} ${text}`
        : `Read the following clearly in a friendly tone: ${text}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-tts-preview",
        contents: [{ role: "user", parts: [{ text: steer }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: data.persona === "suhail" ? "Charon" : "Kore" } } },
        },
        stream_format: "audio",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`Speech failed [${response.status}]: ${body}`);
      try {
        const { logException } = await import("@/lib/exceptions/handle.server");
        await logException("api_failure", {
          userId: context.userId,
          detail: `speech status ${response.status}`,
          context: { channel: "voice", stage: "speech" },
          recovered: true,
          recoveryAction: "text_answer_remains_visible",
        });
      } catch {
        /* ignore */
      }
      throw new Error(response.status === 429 ? "rate_limited" : "speech_failed");
    }

    const buf = new Uint8Array(await response.arrayBuffer());
    return {
      audioBase64: Buffer.from(buf).toString("base64"),
      mime: response.headers.get("content-type") || "audio/wav",
    };
  });

/** Admin-only voice usage metrics from saved transcript metadata. */
export const getVoiceMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await getActiveRoles(context.supabase, context.userId);
    if (!roles.some((r) => r === "system_admin" || r === "service_manager" || r === "auditor")) {
      throw new Error("Forbidden");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data: rows } = await supabaseAdmin
      .from("messages")
      .select("metadata")
      .eq("role", "user")
      .gte("created_at", since)
      .not("metadata->voice", "is", null)
      .limit(5000);
    const { count: failures } = await supabaseAdmin
      .from("exception_events")
      .select("id", { count: "exact", head: true })
      .eq("context->>channel", "voice")
      .eq("context->>stage", "transcription")
      .gte("created_at", since);

    type V = { language?: string; confirmed?: boolean; intent?: string; actionProposed?: boolean; actionCompleted?: boolean; clarification?: boolean };
    const voices = (rows ?? []).map((r) => ((r.metadata ?? {}) as { voice?: V }).voice ?? {});
    const total = voices.length;
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
    const actions = voices.filter((v) => v.actionProposed || v.actionCompleted);
    return {
      total,
      arabic: voices.filter((v) => v.language === "ar").length,
      english: voices.filter((v) => v.language === "en").length,
      transcriptionSuccessRate: pct(total, total + (failures ?? 0)),
      clarificationRate: pct(voices.filter((v) => v.clarification || v.confirmed).length, total),
      actionCompletionRate: pct(actions.filter((v) => v.actionCompleted).length, actions.length),
      failureRate: pct(failures ?? 0, total + (failures ?? 0)),
      failures: failures ?? 0,
    };
  });

/**
 * Admin-only voice evaluation: real spoken audio for each brief scenario goes
 * through the same transcription and routing checks students use. Nothing is
 * written to cases or conversations. Continuity passes only when a real
 * conversation already mixes spoken and typed messages.
 */
export const runVoiceEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await getActiveRoles(context.supabase, context.userId)).includes("system_admin")) throw new Error("Forbidden");
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Speech is not configured.");

    const { runVoiceScenarios } = await import("@/lib/voice/evaluation.server");
    const results = await runVoiceScenarios(apiKey);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: voiceMsgs } = await supabaseAdmin
      .from("messages")
      .select("conversation_id")
      .eq("role", "user")
      .not("metadata->voice", "is", null)
      .limit(200);
    const convIds = [...new Set((voiceMsgs ?? []).map((m) => m.conversation_id).filter(Boolean))] as string[];
    let continuityConv: string | null = null;
    if (convIds.length) {
      const { data: typed } = await supabaseAdmin
        .from("messages")
        .select("conversation_id")
        .eq("role", "user")
        .in("conversation_id", convIds)
        .is("metadata->voice", null)
        .limit(1);
      continuityConv = typed?.[0]?.conversation_id ?? null;
    }
    results.push({
      key: "continuity",
      title: "Voice and typing continuity",
      spoken: "Start by voice, continue by typing, return by voice",
      transcript: "",
      expected: "Same conversation keeps spoken and typed turns",
      passed: Boolean(continuityConv),
      detail: continuityConv
        ? "A real conversation contains both spoken and typed messages"
        : "No conversation yet mixes spoken and typed messages — try it in the Assistant",
    });
    return { ranAt: new Date().toISOString(), results };
  });

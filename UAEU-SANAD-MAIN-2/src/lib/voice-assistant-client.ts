/**
 * Voice transport adapter. The API endpoint delegates the unchanged transcript
 * to the same assistant turn pipeline used by text chat.
 */
import type { AgentResponse } from "./agent-types";
import { apiUrl, getAuthToken } from "./auth-token";

export type VoiceAskArgs = {
  /** The student's spoken words, unchanged. */
  message: string;
  conversationId: string | null;
  lang: "en" | "ar";
  supportAgent: "mira" | "suhail";
  /** Do not claim that hidden voice transcripts are displayed on screen. */
  spokenOnly?: boolean;
};

export type VoiceTurn = {
  /**
   * The assistant response in the text chatbot's layout. Used only when the window
   * must show a submission proposal; it is never spoken.
   */
  response: AgentResponse;
  /** Plain spoken rendering of the answer, produced by the voice endpoint. */
  speech: string;
};

type VoiceTurnResult = { traceId: string; response: AgentResponse; speech?: string };

/** One complete spoken turn. Resolves with the spoken rendering and the underlying response. */
export async function askVoiceAssistant(args: VoiceAskArgs, signal?: AbortSignal): Promise<VoiceTurn> {
  const token = getAuthToken();
  const headers: HeadersInit = token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };

  let res: Response;
  try {
    const init: RequestInit = {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(args),
    };
    if (signal) init.signal = signal;
    res = await fetch(apiUrl("/api/voice/chat/ask"), init);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error("voice_assistant_unavailable");
  }

  if (!res.ok) {
    if (res.status === 429) throw new Error("rate_limited");
    let message = "voice_assistant_unavailable";
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic code */
    }
    throw new Error(message);
  }

  const result = (await res.json()) as VoiceTurnResult;
  if (!result?.response) throw new Error("voice_assistant_unavailable");
  return { response: result.response, speech: result.speech?.trim() ?? "" };
}

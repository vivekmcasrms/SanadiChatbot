/**
 * Browser client for the streaming assistant endpoint.
 *
 * Falls back to the buffered `askAssistant` server function whenever the stream
 * cannot start, so the chat keeps working on networks or proxies that block
 * server-sent events.
 */
import type { AgentResponse } from "./agent-types";
import { getAuthToken } from "./auth-token";
import { askAssistant } from "./agents.functions";

export type ChatAttachmentInput = {
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

type StreamEvent =
  | { type: "accepted"; traceId: string }
  | { type: "token"; delta: string }
  | { type: "reset" }
  | {
      type: "stage";
      stage: string;
      agent?: { key: string; displayName: string; statusText: string; domain: string };
    }
  | { type: "final"; response: AgentResponse }
  | { type: "error"; message: string };

/**
 * Token deltas are coalesced over a very short window before they reach React
 * so a fast model cannot trigger a render per character. 30ms stays visually
 * continuous while collapsing dozens of renders into one.
 */
const FLUSH_MS = 30;

export async function streamAssistant(
  args: {
    message: string;
    conversationId: string | null;
    lang: "en" | "ar";
    attachments: ChatAttachmentInput[];
    voice?: { language: "en" | "ar"; reshaped: number; confirmed: boolean; transcribedAt: string } | null;
  },
  handlers: {
    onDelta: (text: string) => void;
    /**
     * The verification pass started. The already-streamed text MUST stay on
     * screen; this only lets the UI switch to a "finalizing" affordance.
     */
    onFinalizing: () => void;
    /** The one plain-language stage shown while Sanadi is working. */
    onStage?: (
      stage: string,
      agent?: { key: string; displayName: string; statusText: string; domain: string },
    ) => void;
  },
): Promise<AgentResponse> {
  const token = getAuthToken();
  if (!token) {
    return (await askAssistant({ data: args })) as AgentResponse;
  }

  let res: Response;
  try {
    res = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(args),
    });
  } catch {
    return (await askAssistant({ data: args })) as AgentResponse;
  }

  if (!res.ok || !res.body) {
    if (res.status === 429) throw new Error("rate_limited");
    return (await askAssistant({ data: args })) as AgentResponse;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: AgentResponse | null = null;
  let failure: string | null = null;
  let traceId: string | null = null;
  let firstVisibleMs: number | null = null;
  let chunkCount = 0;
  let finalizingAt: number | null = null;
  const requestedAt = performance.now();

  // Micro-batching buffer.
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const text = pending;
    pending = "";
    handlers.onDelta(text);
  };
  const push = (delta: string) => {
    pending += delta;
    chunkCount += 1;
    if (firstVisibleMs == null) {
      firstVisibleMs = Math.round(performance.now() - requestedAt);
      flush(); // first words paint immediately, no batching delay
      return;
    }
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        let event: StreamEvent;
        try {
          event = JSON.parse(line.slice(5).trim()) as StreamEvent;
        } catch {
          continue;
        }
        if (event.type === "accepted") traceId = event.traceId;
        else if (event.type === "stage") handlers.onStage?.(event.stage, event.agent);
        else if (event.type === "token") push(event.delta);
        else if (event.type === "reset") {
          flush();
          finalizingAt = performance.now();
          handlers.onFinalizing();
        } else if (event.type === "final") final = event.response;
        else if (event.type === "error") failure = event.message;
      }
    }
  } finally {
    flush();
  }

  if (final) {
    const measuredTraceId = traceId ?? final.traceId ?? null;
    if (measuredTraceId && firstVisibleMs != null) {
      void fetch("/api/chat/stream", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          traceId: measuredTraceId,
          firstVisibleMs,
          streamChunkCount: chunkCount,
          streamDurationMs: Math.round(performance.now() - requestedAt),
          finalizationMs: finalizingAt == null ? 0 : Math.round(performance.now() - finalizingAt),
        }),
        keepalive: true,
      });
    }
    return final;
  }
  throw new Error(failure ?? "assistant_stream_failed");
}


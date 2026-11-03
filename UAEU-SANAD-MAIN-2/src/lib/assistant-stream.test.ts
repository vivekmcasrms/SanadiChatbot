import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamAssistant } from "./assistant-stream";

const getToken = vi.hoisted(() => vi.fn());
vi.mock("./auth-token", () => ({
  getAuthToken: getToken,
  apiUrl: (path: string) => `https://api.test${path}`,
}));

const fetchChat = vi.fn();
const args = { message: "Hi", conversationId: null, lang: "en" as const, attachments: [] };
const answer = "Hello! Welcome to Sanadi. مرحباً";

function responseStream() {
  const events = [
    { type: "accepted", traceId: "test-trace" },
    { type: "stage", stage: "query" },
    { type: "token", delta: answer.slice(0, 7) },
    { type: "token", delta: answer.slice(7) },
    { type: "reset" },
    { type: "final", response: { answer, conversationId: "test-chat", traceId: "test-trace" } },
  ];
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  return new Response(new ReadableStream({
    start(controller) {
      // Split across JSON tokens and UTF-8 character boundaries, as network reads can.
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchChat);
  fetchChat.mockResolvedValueOnce(responseStream()).mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => vi.unstubAllGlobals());

describe("assistant chat session and streamed text", () => {
  it.each([null, "existing-token"])("delivers text and the final answer with session token %s", async (token) => {
    getToken.mockReturnValue(token);
    const onDelta = vi.fn();
    const onFinalizing = vi.fn();
    const onStage = vi.fn();
    const response = await streamAssistant(args, { onDelta, onFinalizing, onStage });
    expect(response.answer).toBe(answer);
    expect(response.conversationId).toBe("test-chat");
    expect(onDelta.mock.calls.map(([text]) => text).join("")).toBe(answer);
    expect(onFinalizing).toHaveBeenCalledOnce();
    expect(onStage).toHaveBeenCalledWith("query", undefined);
    expect(fetchChat).toHaveBeenCalledWith("https://api.test/api/chat/stream", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify(args),
      headers: token
        ? { "content-type": "application/json", authorization: `Bearer ${token}` }
        : { "content-type": "application/json" },
    }));
    expect(fetchChat).toHaveBeenLastCalledWith("https://api.test/api/chat/stream", expect.objectContaining({
      method: "PATCH", credentials: "include",
    }));
  });

  it("still rejects a session the API does not authenticate", async () => {
    getToken.mockReturnValue(null);
    fetchChat.mockReset().mockResolvedValue(new Response(null, { status: 401 }));
    const onDelta = vi.fn();
    await expect(streamAssistant(args, { onDelta, onFinalizing: vi.fn() })).rejects.toThrow("assistant_api_unavailable");
    expect(onDelta).not.toHaveBeenCalled();
    expect(fetchChat).toHaveBeenCalledOnce();
  });

  it("propagates a server error without inventing a chat answer", async () => {
    getToken.mockReturnValue("existing-token");
    fetchChat.mockReset().mockResolvedValue(new Response('data: {"type":"error","message":"provider_unavailable"}\n\n'));
    const onDelta = vi.fn();
    await expect(streamAssistant(args, { onDelta, onFinalizing: vi.fn() })).rejects.toThrow("provider_unavailable");
    expect(onDelta).not.toHaveBeenCalled();
  });
});

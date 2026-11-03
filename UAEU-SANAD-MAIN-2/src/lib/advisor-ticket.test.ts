import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { voiceRoomTicket } from "./advisor-ticket";
import { getAuthToken } from "./auth-token";
import { apiRefresh } from "./api-auth";
import { isSignedOut } from "./logout-state";

vi.mock("./auth-token", () => ({
  apiUrl: (path: string) => `https://api.example${path}`,
  getAuthToken: vi.fn(),
}));
vi.mock("./api-auth", () => ({ apiRefresh: vi.fn() }));
vi.mock("./logout-state", () => ({ isSignedOut: vi.fn() }));

const ticket = "ab".repeat(32);
const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify({ ticket }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(isSignedOut).mockReturnValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("voice room authentication", () => {
  it("requests the persistent WAV call ticket independently of installed browser/server voices", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    expect(await voiceRoomTicket(new AbortController().signal, false, true)).toBe(ticket);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/api/voice/call/ticket");
  });
  it("requests browser playback without requiring server speech voices", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    expect(await voiceRoomTicket(new AbortController().signal, true)).toBe(ticket);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/api/voice/room/ticket?browserSpeech=true");
  });
  it("sends cookie credentials when there is no cached bearer token", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    expect(await voiceRoomTicket(new AbortController().signal)).toBe(ticket);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example/api/voice/room/ticket",
      expect.objectContaining({ method: "POST", credentials: "include", headers: {}, cache: "no-store" }));
    expect(apiRefresh).not.toHaveBeenCalled();
  });

  it.each([401, 200])("refreshes once after an expired session (%s) and uses the new bearer", async status => {
    fetchMock.mockResolvedValueOnce(new Response("", { status })).mockResolvedValueOnce(ok());
    vi.mocked(getAuthToken).mockReturnValueOnce(null).mockReturnValue("refreshed-token");
    vi.mocked(apiRefresh).mockResolvedValue({ access_token: "refreshed-token" } as Awaited<ReturnType<typeof apiRefresh>>);
    expect(await voiceRoomTicket(new AbortController().signal)).toBe(ticket);
    expect(apiRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer refreshed-token");
  });

  it("does not loop when authentication still fails after refresh", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 401 }));
    vi.mocked(apiRefresh).mockResolvedValue({ access_token: "token" } as Awaited<ReturnType<typeof apiRefresh>>);
    await expect(voiceRoomTicket(new AbortController().signal)).rejects.toThrow("voice_session_expired");
    expect(apiRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops when refresh cannot restore the session", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    vi.mocked(apiRefresh).mockResolvedValue(null);
    await expect(voiceRoomTicket(new AbortController().signal)).rejects.toThrow("voice_session_expired");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not open another connection after interruption during refresh", async () => {
    const turn = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    vi.mocked(apiRefresh).mockImplementation(async () => {
      turn.abort();
      return { access_token: "token" } as Awaited<ReturnType<typeof apiRefresh>>;
    });
    await expect(voiceRoomTicket(turn.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["{}", "<html>Not a ticket</html>", '{"ticket":"undefined"}'])(
    "rejects an invalid ticket response before opening a WebSocket", async body => {
      fetchMock.mockResolvedValueOnce(new Response(body));
      await expect(voiceRoomTicket(new AbortController().signal)).rejects.toThrow("voice_ticket_invalid");
      expect(apiRefresh).not.toHaveBeenCalled();
    });

  it.each([[403, "voice_access_denied"], [429, "voice_service_busy"], [500, "voice_ticket_unavailable"]])(
    "does not refresh or retry a %s server failure", async (status, code) => {
      fetchMock.mockResolvedValueOnce(new Response("", { status: Number(status) }));
      await expect(voiceRoomTicket(new AbortController().signal)).rejects.toThrow(String(code));
      expect(apiRefresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

  it("does not make a ticket or refresh request after explicit sign-out", async () => {
    vi.mocked(isSignedOut).mockReturnValue(true);
    await expect(voiceRoomTicket(new AbortController().signal)).rejects.toThrow("voice_session_expired");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(apiRefresh).not.toHaveBeenCalled();
  });
});

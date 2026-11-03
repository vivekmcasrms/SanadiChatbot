import { apiUrl, getAuthToken } from "./auth-token";
import { apiRefresh } from "./api-auth";
import { isSignedOut } from "./logout-state";

/** Refresh only the session ticket; never replay a submitted voice question. */
export async function voiceRoomTicket(signal: AbortSignal, browserSpeech = false, persistentCall = false): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    signal.throwIfAborted();
    if (isSignedOut()) throw new Error("voice_session_expired");
    const token = getAuthToken();
    const path = persistentCall ? "/api/voice/call/ticket"
      : `/api/voice/room/ticket${browserSpeech ? "?browserSpeech=true" : ""}`;
    const response = await fetch(apiUrl(path), {
      method: "POST", credentials: "include", cache: "no-store", signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const text = await response.text();
    signal.throwIfAborted();
    // Older API builds return an empty 200 from the shared auth challenge.
    if (response.status === 401 || (response.ok && !text.trim())) {
      if (attempt === 0) {
        const session = await apiRefresh();
        signal.throwIfAborted();
        if (session) continue;
      }
      throw new Error("voice_session_expired");
    }
    if (!response.ok) {
      if (response.status === 403) throw new Error("voice_access_denied");
      if (response.status === 429) throw new Error("voice_service_busy");
      throw new Error("voice_ticket_unavailable");
    }
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new Error("voice_ticket_invalid"); }
    const ticket = body && typeof body === "object" && "ticket" in body ? body.ticket : null;
    if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/i.test(ticket))
      throw new Error("voice_ticket_invalid");
    return ticket;
  }
  throw new Error("voice_session_expired");
}

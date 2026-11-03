# Real-time "Talk to Sanadi" voice conversation

## What already exists and will be reused (analysis)

| Need in the brief | Existing Sanadi piece reused as-is |
|---|---|
| Intent detection, agent selection, routing | The assistant's main turn handler (the same one text chat uses), including specialist agents, case-reference-first lookup, complaint / suggestion / career / library routing |
| Knowledge answers | Existing Knowledge Center retrieval with citations |
| Student services and eligibility | Existing service tools (records, registration readiness, holds, documents, appointments, career, library) |
| Proposed actions and confirmation | Existing approval cards and the existing "execute confirmed action" path with duplicate prevention |
| Sign-in and permissions | Existing student sign-in; every request runs as the signed-in student with current access rules |
| Conversation memory | Existing conversation records: voice turns are saved as normal messages in the same conversation, so typing and speaking mix freely |
| Short spoken replies | The spoken-summary rules added last time (conclusion only, "I've shown the details on screen") |
| Errors and recovery | Existing exception catalogue and recovery logging |

Nothing in the brief needs a separate voice-only agent. The tool names suggested in the brief (search_university_knowledge, check_student_eligibility, …) already exist inside the assistant under its own names, so voice gets them by handing each request to the same assistant. No placeholder services will be added.

## What will be built

1. **"Talk to Sanadi" button**: shown prominently above the chat box. It opens a real-time spoken conversation: Sanadi greets the student, listens continuously, notices on its own when they stop talking, and can be interrupted mid-sentence just by speaking.
2. **Live call bar**: animated waveform, clear states (Listening, Thinking, Speaking, Disconnected), Mute/Unmute and End call.
3. **Transcripts in the chat**: both sides of the call appear in the normal chat thread as they are spoken. Cards, documents and approval buttons appear exactly as they do for typed messages.
4. **Same assistant, same rules**: whenever the student asks for information or a service, the voice model hands the request to the existing Sanadi assistant and then speaks only the verified result. It never invents data and never says something is done until the backend confirms it.
5. **Confirmations stay on screen**: consequential actions show the existing approval card; Sanadi says "Please confirm the action shown on screen." Approve/Cancel works by tap; the result and reference number are then read back.
6. **Arabic and English**: Sanadi replies in the language the student is speaking and switches when they switch.
7. **Pilot scope**: General Inquiries, Career Counselling and Ask-a-Librarian are explicitly covered in the voice instructions; other services still work because they go through the same assistant.
8. **Coexistence**: the existing microphone dictation and the current hands-free voice mode stay available. "Talk to Sanadi" becomes the primary voice entry.
9. **Failures**: microphone denied, connection lost or service unavailable show a plain message and keep typing available. These are recorded as exception events. A failed call never restarts on its own.
10. **Privacy**: audio goes directly between the browser and the voice service and is never stored. Only transcripts are saved. No keys reach the browser.
11. **Short technical report** (Word document in Files): changes made, new functions, scenarios tested, remaining limits.

## Testing

Run in preview with a real signed-in student: admission requirements question, career counselling, library question, Arabic to English switch, interrupt mid-reply, voice then typing in the same conversation, a personal-record request (requires sign-in), confirm and reject an action, simulated backend failure, microphone denied. Text chat is re-checked afterwards.

## Technical details

- Uses the Lovable AI Gateway Live API (`openai/gpt-live-1`, verified available for this workspace) with WebRTC audio in the browser and a persistent server WebSocket relay (`/api/live`) holding the server-only key.
- Copy the official relay, browser hook and Vite dev adapter; register the deployed Worker WebSocket entry in `src/server.ts`.
- Authentication: the browser sends the student's access token as the first socket message. The relay verifies it the same way the chat stream endpoint does and builds a user-scoped database client. Unauthenticated sockets are refused.
- Client delegation: the relay's demo `answerQuestion` is replaced with a call to the existing `runAgentTurn` (same conversation ID, `uiLang` from detected speech, voice metadata). Its `AgentResponse` is pushed to the browser to render cards and approvals. The spoken handoff text uses `spokenSummary()`.
- Approvals: the browser uses the existing execute-action server function. After a confirmed action, a short verified result is sent back into the live session to be spoken.
- Transcripts: the user transcript is saved through the normal turn. The Live model's spoken-only lines (greetings, clarifications) are saved as assistant messages flagged `channel: "voice"`.
- Billing and lifecycle cleanup (heartbeat, Stop, unmount) follow the skill. No database schema changes.
- Draft note: the code is built and tested in this draft. Nothing changes in the live app until the draft is accepted.

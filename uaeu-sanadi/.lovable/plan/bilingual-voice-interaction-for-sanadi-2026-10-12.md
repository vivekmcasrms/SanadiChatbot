# Bilingual voice interaction for Sanadi

Voice stays an input channel only. Every spoken turn becomes a normal message in the same conversation and goes through the same assistant, approvals, duplicate prevention and permissions as typed text.

## Already in place (kept)
- Microphone button in the composer, recording indicator, timer, Stop and Cancel
- Automatic Arabic / English / mixed detection, no language picker needed
- Transcript goes into the editable input before sending (auto-send stays optional)
- Same conversation, same case lookup (for example UAEU-2026-01063), same complaint / suggestion / registration routing

## What will be added

1. **Privacy notice on first use**: a short one-time message ("Sanadi uses your microphone only while voice input is active…") before the browser asks for permission.
2. **Automatic stop after silence**: recording ends by itself after about 2 seconds of quiet once speech has started. Manual Stop still works.
3. **University terms come out correctly**: a hint list (UAEU, Blackboard, Career Placement, GPA, course codes) is sent with each recording, and transcripts are cleaned up afterwards, so "c s b p two twenty" becomes CSBP220 and "U A E U 2026 01063" becomes UAEU-2026-01063.
4. **Check before acting on unclear details**: when a case reference or course code in a spoken message was reshaped by that clean-up, Sanadi asks one short check ("I heard the course code as CSBP220. Is that correct?") before any action. Read-only answers continue normally.
5. **Listen button on answers**: a "Listen" button on finished assistant replies reads only the visible answer text (no links, references or card labels), in an Arabic or English voice to match the reply. A settings switch turns on "read every answer aloud"; it is off by default.
6. **Voice conversation mode (optional)**: a "Start voice conversation" button that listens, sends, reads the reply aloud, then listens again until the student stops. Every turn still creates a normal message.
7. **Friendly error messages**: microphone unavailable, permission denied (with how to enable it), no speech heard, and service failure, each with Retry or keep typing. These are recorded as Sanadi exception events with no provider details.
8. **What gets saved**: transcript, detected language, time, whether the message was spoken, and the resulting intent and agent. Raw audio is never stored.
9. **Admin voice metrics**: voice interactions, Arabic vs English, transcription success rate, clarification rate, voice-to-action completion rate, and service failure rate, on the Admin reporting page.
10. **Evaluation evidence**: a "Voice Interaction" section that runs the six brief scenarios (English complaint, Arabic suggestion, existing case, CSBP220 registration, ambiguity, continuity) through the real pipeline using sample spoken audio, and shows pass/fail from real results.

## Technical details
- Speech-to-text: keep the current transcription server function; add a `prompt` vocabulary hint and a deterministic post-normaliser (`src/lib/voice/normalize.ts`) with unit tests for case refs, course codes and GPA numbers.
- Silence detection in `useVoiceRecorder` using the RMS level already computed.
- Text-to-speech: new authenticated server function calling the gateway TTS default model; client strips markdown, URLs and IDs before sending; audio is played from memory only.
- Persistence: add `input_channel`, `voice_language`, `voice_normalized` columns to the chat message table (migration and RLS unchanged); orchestrator logs intent/agent as it does now.
- Metrics: one admin-only server function aggregating those columns plus voice exception events.
- Evaluation: admin-only scenario runner generates the test phrases with TTS, transcribes them, and runs them through the orchestrator in a test-flagged conversation that is cleaned up afterwards (no real cases created).
- Tests: vitest for the normaliser and the "needs confirmation" rule.

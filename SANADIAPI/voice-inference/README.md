# Voice advisor and optional private inference sidecar

The default advisor uses the existing server speech-to-text service, the active database-configured assistant model, and installed Windows server voices. It does not require LiveAvatar or a workstation Ollama instance. The private Whisper/Chatterbox setup below is optional; no private service is currently provisioned.

This small FastAPI process exposes only the OpenAI-compatible routes consumed by `Sanadi.Api`. Bind it to loopback or a private inference VLAN. It requires an API key and does not write uploaded audio to a persistent directory; temporary ASR files are removed after transcription. Do not enable request-body logging at the reverse proxy.

The selected stack is [faster-whisper](https://github.com/SYSTRAN/faster-whisper) for local multilingual ASR and [Chatterbox multilingual V3](https://huggingface.co/ResembleAI/chatterbox) for local English/Arabic synthesis. Chatterbox's model card lists 23 languages including Arabic and MIT licensing. [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) has Apache-2.0 weights but its documented voices/languages do not include Arabic, so it is not used as the Arabic voice.

## Install on Windows Server

Use Python 3.11 in a dedicated virtual environment and install the matching PyTorch build for the server's CUDA driver (or CPU wheel), then install `requirements.txt`. Download Whisper large-v3 into a local directory before deployment and set `WHISPER_MODEL_PATH` to that directory. Pre-cache the Chatterbox multilingual V3 weights during an approved deployment window. Set `HF_HUB_OFFLINE=1` after the model cache is ready.

Set these machine environment variables through the service manager, not in source control:

| Variable | Purpose |
| --- | --- |
| `VOICE_SERVICE_API_KEY` | Long random shared secret used only between API and sidecar |
| `WHISPER_MODEL_PATH` | Local faster-whisper model directory |
| `VOICE_FEMALE_REFERENCE` | Consent-cleared WAV reference for the female voice |
| `VOICE_MALE_REFERENCE` | Consent-cleared WAV reference for the male voice |

Start with `uvicorn service:app --host 127.0.0.1 --port 8091 --workers 1`. The models are loaded once per process; do not increase worker count without enough GPU memory. For a multi-host setup, bind to a private interface, allow only the API host through the firewall, terminate TLS internally, and apply per-session concurrency limits.

Configure the API's protected settings:

```json
"Voice": {
  "WhisperBaseUrl": "http://127.0.0.1:8091",
  "WhisperApiKey": "<same secret from service manager>",
  "AssistantBaseUrl": "http://127.0.0.1:<private IIS binding>",
  "TtsBaseUrl": "http://127.0.0.1:8091",
  "TtsApiKey": "<same secret from service manager>",
  "TtsModel": "chatterbox-multilingual-v3",
  "FemaleVoice": "female",
  "MaleVoice": "male"
}
```

Use environment overrides or a protected IIS configuration source for secrets. Keep the sidecar port private. Chatterbox multilingual supports English and Arabic and is MIT licensed; its upstream model page says outputs include a perceptual watermark. Kokoro-82M weights are Apache-2.0, but the upstream language list does not include Arabic, so this integration uses Chatterbox for both languages.

## Voice identity and UAE accent

The model accepts speaker reference audio. The two reference WAVs must be legally obtained with explicit speaker consent. The code preserves those two identities across English and Arabic, but it cannot guarantee that the generated voice has a UAE English or Emirati Arabic accent. Only a native UAE voice evaluation and, if needed, a properly licensed fine-tune on consent-cleared UAE speech can establish that claim. Do not call the configured references Emirati voices until that validation is complete. Maintain separate native-speaker reference material for each language where cross-language accent transfer is inadequate.

## Voice advisor UI (2026-10-20)

Open `/voice`, or **Voice conversation** beside the assistant selection in chat. The portraits are static user-provided assets. There is no LiveAvatar dependency, external avatar subscription, generated video, or claimed lip synchronization.

The dedicated advisor uses:

1. A microphone opened only by an explicit click. AudioWorklet captures complete mono PCM WAVs; a pause ends the question and closes every microphone track. Silence and short clicks do not create questions.
2. `POST /api/voice/room/ticket` authenticates the student and issues a single-use, origin-bound 30-second ticket. The browser connects to `/api/voice/room` over WebSocket using that ticket in a subprotocol, never putting its access token in a URL. One private turn room accepts the question WAV; a new room cancels the student's previous one.
3. The server transcribes using the existing `VoiceTranscriptionService` with `language: auto` (or private Whisper when fully configured). **Arabic questions receive Arabic replies; English questions receive English replies.** UI/profile language is not accepted in the room protocol. STT still requires a configured speech-capable service; the Ollama chat endpoint is not a transcription engine.
4. `AssistantController.RunTurn` retains the existing agents, student records, evidence, permissions and service workflows. It loads the active model through `usp_Assistant_GetAiSettings`, including the deployed `ai_settings`/`AISettings` compatibility procedure. The saved URL, key, model, token limit and thinking setting are used unchanged. There is no localhost/model fallback. For Ollama phrasing, `stream: true` is sent to the saved endpoint and SSE or NDJSON content is read as it arrives; reasoning fields and `<think>` content are excluded from speech. Interrupted or incomplete streams are not replayed as a second response.
5. Complete sentences enter a bounded queue while the model is still generating. A single TTS path creates a WAV for each sentence; the server sends its metadata and 32 KB binary WebSocket chunks. The browser assembles each sentence WAV and plays the queue in order, starting before the full reply finishes. Deterministic service replies are queued after the backend returns; approval-gated submissions still use the existing confirmation dialog.
6. Without private TTS, `System.Speech` generates WAV audio on the Windows API server. Meera (`mira`) selects only a female voice in the question's language; Suhail selects only a male voice. UAE voices are preferred if installed. Optional `Voice:WindowsFemaleVoice`/`WindowsMaleVoice` names must also match gender and language. Missing Arabic/English voices produce an explicit error, never a different gender/language. With a configured private adapter, the fixed Chatterbox voice IDs are used instead. Browser TTS and the legacy public `/speak` service are not used by this advisor.
7. One Web Audio playback source. Pressing the microphone, changing advisor, ending, hiding the tab or signing out closes the room, cancels upstream work, discards queued audio and stops playback. Generation checks reject late results. No microphone is open during playback; interruption is **by pressing the microphone**, not ambient always-on listening.

Captions are optional and off initially. They show the completed question and the sentence being played, not partial live transcription. Service proposals and transaction cards remain accessible below the portrait on mobile. The existing approval dialog performs submissions; only its confirmed response is spoken as a transaction result through the server speech endpoint. Users can review/edit supported request subjects and bodies before approving. Saying “show…”/“اعرض…” also displays the answer.

No changes to SQL authentication, SSO, student seeds, agent routing, SLA workers or escalation logic are required. The old `/api/voice/turn` and `/api/voice/speak` endpoints remain available for their existing callers. The new advisor never calls those endpoints.

## Configuration and operational limits

For optional private speech, configure `Voice` settings above on **SANADIAPI**, using Visual Studio secrets, protected server configuration or environment overrides (`Voice__TtsBaseUrl`, etc.). Otherwise install the required male/female English/Arabic SAPI voices on the Windows API server and ensure the service identity can access them. Never put service secrets in frontend `VITE_` settings.

Additional optional API settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `Voice:Enabled` | `true` | Administrator switch for advisor sessions |
| `Voice:MaxSessionSeconds` | `600` | Browser session limit (clamped to 60–1800 seconds) |
| `Voice:IdleSeconds` | `120` | Browser idle closure (clamped to 30–300 seconds) |

The advisor is available when enabled and either hosted on Windows or the private adapter is configured. Language-specific voice availability is checked before synthesis. Recording is limited to 45 seconds, input size is bounded, each server room expires after three minutes, and existing API voice concurrency limits apply. Windows synthesis has a two-job capacity limit and sentence queues are bounded. Voice metrics reuse the existing in-memory admin metrics store. Session/idle timers are resource controls, **not durable billing quotas**. There is no avatar-provider credit spend. Deployments needing per-student daily compute budgets and durable cost accounting need an authoritative quota store.

Serve the UI over HTTPS on phones (localhost is only a development exception). The reverse proxy/IIS deployment must support WebSocket upgrades to `/api/voice/room`, WSS, and long-lived connections. Keep any optional sidecar private. Start SANADIAPI from Visual Studio as usual. The static UI server's SPA fallback must serve `/voice` on refresh. A disconnected turn requires an explicit retry; service requests are never automatically replayed.

## Privacy and validation status

The sidecar uses temporary ASR files which are deleted after recognition; synthesized WAVs stay in memory. Neither raw audio nor transcripts should be logged by the proxy. Voice transcripts are still passed to the existing assistant engine, which persists ordinary conversation messages under its existing retention policy. Hiding text in the voice UI does **not** disable that storage.

The model streams tokens; TTS works on complete sentence units and streams their WAV bytes over WebSocket. This is not partial live STT or sample-by-sample neural TTS generation. It avoids waiting for the entire model reply. Abort stops browser playback immediately; an optional Python worker may finish already-running GPU inference before accepting the next request. Tune hardware/queue capacity from measured latency.

Local checks cover model SSE/NDJSON streaming, thinking suppression, sentence boundaries, cancellation, single-use room tickets, database request-value preservation, private voice mapping, WAV encoding and endpointing. Windows tests generate real English WAVs for both genders without playing them. Browser tests use synthetic audio and intercepted WebSockets/APIs; they do not establish real Arabic speech quality or university transaction correctness.

Repeat focused checks:

- API: `dotnet test tests/Sanadi.Api.Tests/Sanadi.Api.Tests.csproj --filter "FullyQualifiedName~VoiceStreamingTests|FullyQualifiedName~PrivateVoiceServiceTests|FullyQualifiedName~VoiceSpeechFormatterTests|FullyQualifiedName~OllamaChatRequestTests"` (real Windows speech tests need access to installed voices)
- UI: `npm run test:voice`
- Browser contracts: build and serve the UI on `127.0.0.1:8080`, then `npm run test:voice:ui`. This uses headless Edge, a synthetic microphone and intercepted APIs; it never submits a real service request.

Before release, provision working STT and both genders in both TTS languages (installed server voices or private service), then test:

- Meera and Suhail in both languages with native UAE speakers; identity, intelligibility, pacing and accent.
- iOS Safari and Android Chrome microphone permissions, audio unlock, interruption, backgrounding and network loss.
- Real authenticated profile/course/career questions and each allowed service workflow, including editing a proposal, approval, confirmed success/failure, document issuance and case follow-up.
- Latency and concurrency on the actual inference host; browser emulation does not establish real mobile performance.

The checked machine has English Microsoft Zira/David voices but no installed Arabic voices or private speech service. Arabic production audio therefore remains blocked until appropriate server voices are provided. The API was not started here; real database-configured Ollama, authenticated student-service execution and real mobile-device validation remain pending. This feature must not be described as production-validated yet.

Protocol references: [Ollama streaming](https://docs.ollama.com/api/streaming), [OpenAI-compatible chat](https://docs.ollama.com/api/openai-compatibility). The integration uses the configured university endpoint, not documentation localhost examples.

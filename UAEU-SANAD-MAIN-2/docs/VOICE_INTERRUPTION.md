# Server-side voice activity detection

## Shared call pipeline (3 November 2026)

Both the assistant microphone and `/voice` now mount `VoiceChatMic` and use
the authenticated C# `/api/voice/call` protocol. The new dedicated screen includes
language/voice selection, transcript review, action confirmation cards, documents,
results and a link back to the same conversation in text chat. No new Node runtime
service or database schema/procedure is required. The existing Qwen configuration,
Whisper, Chatterbox and packaged C# Silero model remain the model stack.

These changes supersede the earlier translation and thank-you behavior below:

- Recognition preserves the original Arabic/English transcript. The reply-language
  selector controls the answer, not a translation of the student's identifiers.
  The browser sends that preference separately as `recognitionHint`. If auto-detection
  returns an unsupported language/script, C# retries the same WAV once with that hint.
  A supported first result is never retried or translated. This restores recognition
  recovery that was accidentally coupled to the removed `targetLanguage` field.
  The browser also accepts Arabic script extensions such as tatweel (`ـ`).
- Only an explicit goodbye/end-call phrase closes the call. Thank-you alone does not.
- `Voice:EndpointSilenceMs` defaults to 1200 (clamped to 640–2400), and
  `Voice:AdaptiveEndpoint` defaults to true. Short utterances receive another 320 ms
  for hesitation. This is acoustic timing, not semantic turn-completion detection.
- Both screens expose Interrupt and speak. Cancelled generation and late socket
  results are discarded by turn ID. Interruption cannot undo an already committed action.
- Transcripts containing numbers, identifier/date terms or explicit name markers
  require editable on-screen review. This is a conservative heuristic, not a claim
  of Whisper confidence or automatic detection of every misrecognized name.
- Exact spoken confirmation applies only to the latest assistant message's single
  executable proposal, within five minutes. It uses the existing action checks and
  unique idempotency storage. Multiple/stale proposals require card confirmation.
  Uncertain execution outcomes are marked for review and are not automatically retried.
- Recent question, answer and workflow state support follow-ups. Knowledge is
  retrieved again; earlier answers are not treated as evidence. Ambiguous selections
  request clarification; deterministic ordinal selection currently supports library cards.
- Validated final replies are synthesized in complete segments with bounded prefetch.
  Business results are not spoken before completion. This reduces whole-reply TTS
  waiting; it does not stream unvalidated Qwen tokens into speech.

Metrics use existing `audit_logs` storage without audio or transcript payloads.
`first_audio_ms` measures server turn preparation through first audio send;
`first_playback_ms` measures browser transcription-start through first answer playback,
excluding reviewed or muted turns. It excludes the earlier VAD silence window.
Browser timings/interruption events are client telemetry, not trusted action audits.
The admin `/api/voice/metrics` snapshot includes persistent counts and mean timings.

Before release, validate on the actual speech gateway with English, Emirati Arabic,
mixed course codes, long pauses, loudspeaker echo, interruption during generation
and playback, and two attempts to confirm the same proposal. Microphone quality,
pronunciation and live-model-level latency cannot be established by unit tests.

## English/Arabic transcript validation (2 November 2026)

Recognition validates the returned script and, when provided by the speech server,
its detected language. An unsupported automatic detection retries the same WAV
once with the selected English/Arabic language. It never guesses a replacement
word or translates from the rejected transcript. A second unsupported result asks
the user to repeat while keeping the call available; no chat turn is submitted.
Same-language recognition, English/Arabic display translation, mixed English/Arabic
course names and numbers keep their existing paths. Translation and browser output
also reject third-script text, including with an older API deployment. This does not
change text-chat language selection, business routing or the thank-you sign-off.

## Thank-you call ending (2 November 2026)

The voice result confirms a recognized thank-you sign-off before farewell audio
generation. Only that closing turn stops microphone capture, preventing queued
speech-detection callbacks or farewell echo from cancelling the automatic hang-up.
The existing End Call cleanup runs immediately after the final audio finishes.
Older servers that send the sign-off flag only in `done` remain supported. Manual
End Call and explicit interruption still work, and ordinary turns, text chat,
response content and business routing are unchanged. A thank-you followed by a
new question continues through the existing answer path.

## Voice processing acknowledgments and prepared welcome (2 November 2026)

`Voice:ProcessingAcknowledgments:Enabled` in the API configuration controls the
optional processing audio (environment override: `Voice__ProcessingAcknowledgments__Enabled`).
It is enabled in the current base configuration. Set it to `false` and reload the
voice UI after restarting/recycling the API to disable it. With it disabled, no cue
audio or timers run; text chat, voice answers, tools and submission approvals keep
their existing paths. The independently requested welcome preload remains enabled.

The browser preloads the configured assistant's public welcome WAV while the chat
is open, so an available recording plays after the microphone and call connection
are ready, without another synthesis request or WAV download. If preparation is
incomplete or unavailable, the original server welcome is used. First-use microphone
permission, network connection and a cold synthesis cache can still add delay.

Feedback language is determined from the original transcript before the existing
selected-language translation. Mixed speech uses the same word-based language rule
as the assistant. Translation and the question sent to the business pipeline are
unchanged. Language is unavailable at the raw VAD pause, so acknowledgment starts
after successful transcription, with a 150 ms grace window for immediate results.
Standalone greetings and thank-you sign-offs skip it. A waiting cue becomes eligible
after 3 seconds of request processing; further cues are at least 12 seconds apart,
never overlap, and never repeat within that request. No cue claims completion or
predicts how soon processing will finish.

All clips use the configured server voice and stay in bounded memory caches.
Only already prepared clips are played; missing or failed optional audio is silent
and never delays or retries a business request. When a question is submitted,
background preparation queues no more clips; its one in-flight public clip may
finish and be cached, avoiding repeated cancellation and regeneration. End Call,
selection changes and leaving the page still cancel preparation immediately.
Final results, errors, interruption, mute and End Call
cancel processing cues. Cue text is kept out of chat messages and final answers.

The speech transport distinguishes caller cancellation from an upstream timeout.
Expected cancellation of optional preparation ends quietly. A timeout covers the
complete WAV download and can retry that unsent audio once; it never retries a
chat turn, tool or submitted action. Persistent failures still use the existing
voice error path. Interrupted speech remains cancelled and cannot replay.

This update requires the API and UI changes together; existing clients and API
response shapes remain supported. No database migration or environment URL change
is needed. Automated coverage lives in the voice UI suite and API voice tests.

Voice activation is classified by the .NET API using a packaged Silero V5 model.
The browser captures microphone audio and sends a separate PCM16 copy to the
authenticated `/api/voice/activity` WebSocket. There is no browser VAD model,
browser AI runtime, CDN, or additional JavaScript dependency.

H200 STT/TTS endpoints, selected-language handling, business routing, and the
original recording sent for transcription are unchanged. VAD neither transcribes
speech nor identifies its language. Detection failure stops the capture with an
error instead of falling back to activation by noise volume.

## Sensitivity

- No absolute minimum volume or estimated-distance cutoff is imposed on speech.
- The 29 October background-activation trial is enabled by default on the API.
  Each recording learns a background level from confident non-speech frames only.
  A lower-quartile estimate limits the influence of isolated impacts; learning is
  suspended during speech candidates and after speech is accepted.
- The 2 November conservative activation update is enabled by default on the API.
  Clear speech requires 192 ms of qualifying frames (six 32 ms frames), including
  before calibration. No separate startup calibration wait is added.
- After calibration, speech close to the measured background requires 384 ms of
  qualifying frames (twelve frames), even when the model is confident it is speech.
  A single clearer frame cannot bypass this check: six clear frames or twelve
  total qualifying frames are needed. Quiet sustained speech is delayed rather
  than permanently rejected. No speaker identity or distance is inferred.
- Short gaps are tolerated; a pause is reported after 960 ms (30 frames)
  of non-speech. These confirmation durations count qualifying frames, not a
  guaranteed wall-clock response time; gaps, model recognition and network latency
  add to them. Continuing speech resets the silence counter. The 30 October
  conversational voice update reduced the former 1.1-second pause to 960 ms.
- The utterance and up to two seconds before detected onset are retained for STT.
  Older idle audio is excluded using the server's processed frame sequence rather
  than callback arrival time; network latency therefore does not move the trim point.

Quiet voice sensitivity depends on microphone quality and background noise.
VAD can make mistakes and cannot enforce an exact distance or distinguish a
nearby person from speech played by a television.
The guard reduces brief speech triggers; sustained neighbouring
speech can still pass. Very short, quiet, low-confidence nearby words can also be
missed, so test words such as "yes" and "no" on the actual device. Background voices
in an accepted recording are not removed from the audio sent to STT. The API trial
does not alter microphone capture or the H200 recording.
The UI already requests browser noise suppression and echo cancellation. Browser
support varies, and those constraints do not identify the intended speaker or
guarantee removal of surrounding conversations. The earlier API VAD trial
introduced no new audio filter, dependency, transcription pipeline, text-chat
behavior or response logic. Subsequent voice-input changes are detailed below.

### Browser microphone gain update (2 November)

Hands-free `VoiceChatMic` now requests `autoGainControl: false` by default while
keeping `noiseSuppression: true` and `echoCancellation: true`. Automatic gain can
amplify quiet input; avoiding it may reduce surrounding sound pickup. This is a
browser preference, not a mandatory constraint, so devices that cannot honor it
still open. Driver or hardware processing can remain active. Quiet intended
speech can also be quieter and must be checked on the actual microphone.

This does **not** enforce one metre, identify the intended speaker, remove other
voices, or guarantee fewer transcriptions. The current VAD still accepts sustained
speech; increasing its delay alone cannot solve that. No amplitude cutoff or
automatic enrollment from the first voice heard is introduced. Response logic,
language handling, the voice buttons, interruption and call-ending logic are
unchanged. Other microphone capture features retain their settings.

To restore the previous gain request, set `VITE_VOICE_AUTO_GAIN_CONTROL=true` in
the UI environment, restart the UI dev server or rebuild/deploy the UI, then open
a new voice call. With no override the new preference applies to new calls after
the updated UI loads. This browser change needs no API restart or database change.
It has not been validated against a real room or microphone distance.

### Non-speech transcription checks (2 November)

The private recognition adapter now rechecks the UI's mono PCM16/16 kHz WAV with
the existing embedded speech detector before calling SQL or the speech provider.
When no speech is detected it returns an empty transcript, so the UI continues
hands-free listening without adding a question or running an assistant action.
The recording is read in memory, never logged or stored, and speech samples are
not edited by this server check. Other recording formats retain the previous
provider validation. Explicit language validation, authentication, cancellation,
text-chat routing and speech-number verification remain in place.

`Voice:ValidateTranscriptionSpeech` defaults to `true`; set the API environment
variable `Voice__ValidateTranscriptionSpeech=false` and recycle the API to restore
the prior transcription path. The server check requires rebuilding/deploying the
API. The idle-audio trim requires the updated UI; it works with the existing VAD
protocol. No database migration or repeated button presses are required.

A live synthetic probe found that the configured gateway returned empty text for
four seconds of silence but rejected `verbose_json` with HTTP 422. Its existing
`json` request format is preserved; no unavailable confidence field or phrase
blacklist is used. The screenshot alone cannot establish whether a phrase came
from background speech or a recognition error. These guards cannot reject every
false detection, distinguish speakers, or enforce a one-metre boundary. They do
not remove another person's speech inside an accepted utterance. Calibration and
speaker identification have not been added.

Validation: 1,158 backend tests passed (six live-service tests skipped), all 210
voice UI tests passed, and the embedded-model smoke check passed 19 synthetic
cases. The new transcription guard retained 15 normal/quiet English speech cases
and rejected four non-speech cases. Arabic/English flow tests use mocks; no live
Arabic room recording or microphone-distance test was performed. Results are in
`tmp/voice-input-guard-*2026-11-02.*` and `tmp/voice-idle-audio-tests-2026-11-02.log`.

### Stronger automatic interruption (2 November)

During an active reply (including welcome/preparation), the UI now masks faint
frames in the PCM copy sent to VAD. The default minimum RMS is `0.02`, with 96 ms
of sustained input above that level before unmasked frames enter the existing
server speech detector. The detector must still confirm speech before interruption;
a loud sound alone cannot start a turn. This is a microphone level, not metres,
and can favor louder/closer speech without identifying who is speaking.

Normal listening between replies is unchanged. Once the server accepts speech,
quiet continuation and the existing end-of-speech timing resume. Original STT
samples and the two-second lead-in are preserved. The existing **Interrupt and
speak** button immediately returns to normal listening; the call remains open.
There is no new calibration step or repeated button requirement. Text responses,
English/Arabic routing, greetings, farewell cleanup and response narration are
unchanged. A quiet/short interruption may now be missed; the actual laptop
microphone still needs testing. Loud surrounding speech can still interrupt.

This change requires the updated UI only. `VITE_VOICE_CLOSE_INTERRUPTION=false`
restores the previous interruption PCM path. `VITE_VOICE_INTERRUPTION_MIN_RMS`
accepts `0.001` through `0.2` (default `0.02`); raising it requires stronger input
and can also block the intended user's interruptions. Restart/rebuild the UI
after changing an environment value, then reopen the call. No API or database
change is needed for this interruption filter.

Validation: all 227 voice UI tests passed. The actual TypeScript filter and PCM
encoder were also applied to five local synthetic English speech fixtures; their
output passed all 19 embedded-model checks, including short replies and attenuated
variants. This does not establish an interruption distance or guarantee rejection
of another speaker. No live noisy-room or Arabic microphone test was performed.
Logs: `tmp/voice-close-interruption-tests-2026-11-02.log` and
`tmp/voice-close-interruption-audio-2026-11-02.json`.

## Trial deployment and rollback

The VAD trial changes the API detector only; no UI rebuild or H200 change is needed.
Publish/restart the updated API used by the UI to test it. Existing UI deployment
URLs and other application settings are unchanged.

To restore the behavior immediately before the 2 November update while retaining
the earlier background guard, set this API environment variable and restart/recycle
the API:

```text
Voice__ConservativeSpeechActivation=false
```

The equivalent configuration key is `Voice:ConservativeSpeechActivation`; its
default is `true`. This changes activation timing only. Silence detection,
interruption cleanup, farewell handling and the original audio sent for
transcription remain unchanged. No UI rebuild is required.

To also disable the older background guard and restore probability-only activation:

```text
Voice__ReduceBackgroundActivations=false
```

The equivalent API configuration key is `Voice:ReduceBackgroundActivations`.
Its default is `true`; configuration is read when the detector is constructed.
The `false` setting restores the previous probability-only activation gate.

Exact pre-trial copies of the detector, its tests and this document are retained
under `.rollback-audit/voice-background-trial-20261029/before/` at the workspace root.
The companion `restore-previous.ps1` first verifies backup and current-file hashes
and refuses to overwrite subsequent edits. Run it without arguments to preview;
use `-Restore` to restore those three files only, then rebuild/publish the API:

```powershell
powershell -NoProfile -File ".rollback-audit/voice-background-trial-20261029/restore-previous.ps1" -Restore
```

The restore script does not stop a service, change deployed binaries, touch `.env`,
or modify SQL. Retain the previous API deployment package for a binary rollback.

## Deployment and security

### Conversational voice update (30 October)

Opening the microphone starts the selected advisor's English or Arabic welcome.
The microphone remains active during playback, so student speech cancels the
welcome or current reply. The welcome uses a separate `greet` command: it does
not create a student message, conversation, or service action. Voice chat shows
listening/speaking status without working-agent labels; text progress remains.

Answers still run through `AssistantController.RunTurn`. The completed full
response is unchanged; `VoiceReplyNarration` selects its spoken overview.
`VoiceCallDelivery` adds only bounded audio metadata and occasional configured
acknowledgments. It does not call another answering model or run a tool.

- Ordinary replies target a 100–150 ms initial pause; longer explanations target
  150–200 ms. Model and TTS preparation time counts toward this target, so a
  response that already took longer starts without another artificial pause.
  Complexity is a presentation heuristic based on the completed
  response's length and structure, not an assessment of the student's question.
- Every third eligible verified explanation can use one acknowledgment from
  `Voice:Conversation:Acknowledgments`, rotating without consecutive repeats.
  Greetings, simple results, document receipts, clarifications, fallbacks,
  handoffs and privacy refusals do not receive filler.
- Audio pauses 120 ms after an acknowledgment and 60–100 ms between subsequent
  chunks. A late chunk counts its existing network/TTS gap toward this pause.
  Playback rate varies within 0.98–1.02. The selected TTS voice and
  source sentences are retained. Punctuation supplies the TTS phrasing.
- All scheduled audio and pauses are cancellable. Capture remains silent while
  the student is speaking; there are no overlapping listening acknowledgments.
- STT and network latency still affect the overall response time. A short user pause resets
  when speech continues; silence alone cannot prove the student has finished.

The welcome, shared greeting/evidence prompts, and greeting-repair prompt all
use `SupportAgentPersona` for the selected advisor's name. Sanadi remains the
service name. Confirmed social-only turns reach the existing greeting handler
after the privacy check, without unrelated service-context lookups. Regular
voice replies synthesize their first complete sentence separately to reduce
the initial audio preparation work; welcome and farewell grouping is retained.

The chat UI optionally prepares the selected public welcome before microphone
activation. The authenticated `api/voice/call/prepare` action reuses the configured
voice and wording. `VoiceWelcomeAudio` keeps at most four clips in API memory for
20 minutes, separated by advisor/language and invalidated by gateway/key changes.
It never caches student questions or replies. Warm-up does not open the microphone,
play audio, refresh login, or run a chat action. The existing WebSocket greeting
plays the prepared clip without an added pause; a cold/failed warm-up generates it
normally. Initial connection, microphone permission and a cold speech service can
still delay playback. The API must be updated to enable this preparation route.

Deploy the updated API and `appsettings.json` before the rebuilt UI. The `greet`
command needs the updated API. Existing clients can ignore the added audio
metadata; new clients accept audio without it. The university TTS request
format, endpoint and credentials have not changed.

Publish the API first, then the complete UI `dist/client` directory. Deploy the
normal NuGet native runtime files with the API; the model is embedded in the API
assembly. No H200 service configuration change is required.

The model performs no runtime download or external service call. Native ONNX
telemetry is disabled before initialization and through the runtime API.
Existing application API connections and browser security policy remain intact.

VAD uses authenticated, origin-bound, single-use connection tickets, an independent
session registry, fixed-size frames, bounded client buffering, server concurrency
and frame-rate limits, and connection timeouts. Audio is processed in memory and
is not logged or written to disk by VAD. Microsoft.ML.OnnxRuntime is pinned to
1.31.1; the model's SHA-256 is
`2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`.

Security checks cover known advisories and the added implementation; they do not
prove the application is free of all vulnerabilities. Existing unrelated package
findings are not automatically upgraded as part of this voice change.

### Generated speech cleanup and identifier checks (31 October)

Both speech adapters and the legacy voice turn endpoint apply `VoiceAudioCleanup`
to generated WAV audio. It supports
16-bit PCM and 32-bit float output, including the format returned by the university
gateway. Quiet noise in pauses is attenuated with short fades; speech and 120 ms
around it are preserved. Audio duration, microphone capture, voice selection,
text responses and business actions are unchanged. Very quiet utterances and
unsupported formats pass through. This conservative gate does not remove noise
mixed into spoken syllables; that requires improvement at the speech service.

Long ungrouped digit sequences (five or more digits) are spoken digit by digit,
preserving repeated and leading zeros in English and Arabic. Dates, decimals,
grouped quantities and short numbers retain their existing treatment. This is
pronunciation formatting only: stored identifiers and the full displayed answer
are unchanged.

`VoiceNumberSpeech` checks generated number audio using the configured
transcription service before releasing it. It permits at most two pronunciation
attempts, with a 10-second timeout for each verification. A mismatch, timeout or
unavailable verification causes a short instruction to read the exact number on
screen instead. No assistant action is repeated. Number verification adds speech
service work only to these digit sequences. Audio is processed in memory without
an identifier cache or file logging. Recognition is itself probabilistic; this
check reduces known pronunciation errors rather than guaranteeing perfect speech.

Publish/recycle the API to activate this update. It needs no UI rebuild, new
provider credentials, database change or application URL change.

## Verification

UI tests cover transport, quiet audio preservation, cancellation, deadlines, and
unchanged STT language arguments. API tests cover the gate, embedded model,
authentication, ticket isolation, and frame limits. `SANADIAPI/tools/VoiceActivitySmoke`
exercises the actual model using local synthetic speech at different volumes and
synthetic non-speech signals; it does not call STT, TTS, or external services.

For the 29 October trial, an isolated runner compiled the actual detector/test
source without building or running the full API. All 31 detector test cases and
an exact pre-trial gate comparison over 250,000 randomized frames passed. Across
50 synthetic audio scenarios per mode, enabled and disabled detection/timing were
identical. The original 13 smoke cases passed in both modes; three added very quiet
speech-in-noise cases were missed by both versions because the model's probability
never reached the existing speech threshold. These tests show no added regression
in those fixtures, but do not demonstrate improved neighbour rejection.

For the 2 November conservative activation update, the full backend suite passed
1,153 tests (six live service tests skipped), and all 206 voice UI tests passed.
Twelve new gate cases cover brief bursts, sustained quiet speech, background-level
speech, gap resets, unchanged endpoint timing and both rollback switches.
The actual embedded model passed all 19 offline audio cases with both the previous
and updated gate: five synthetic English utterances at three volume levels, plus
silence, clicks, object/tone sounds and steady noise. These included short replies
and a farewell. No additional misses occurred in those fixtures; speech activation
was 96 ms later in each speech case. The check does not establish performance for
live Arabic speech, real microphones or surrounding conversations. Those still
require testing on the intended device. Current logs are in
`tmp/voice-sensitivity-*-2026-11-02.*`; the smoke tool accepts the test-only override
`SANADI_VAD_TEST_Voice__ConservativeSpeechActivation=false` for the previous gate.

Test the trial on the intended device with normal speech, quiet speech, short
answers such as "yes/no", and another person speaking farther away, including
while the assistant is talking. Compare with the rollback switch disabled. Reports
are saved under `.rollback-audit/voice-background-trial-20261029/validation/`.

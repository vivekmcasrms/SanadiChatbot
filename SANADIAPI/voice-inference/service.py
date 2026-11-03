"""Private Whisper and Chatterbox adapter used by Sanadi.Api."""
from __future__ import annotations

import os
from io import BytesIO
import tempfile
from threading import Semaphore
from pathlib import Path

import soundfile as sf
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from faster_whisper import WhisperModel
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
api_key = os.environ["VOICE_SERVICE_API_KEY"]
device = "cuda" if torch.cuda.is_available() else "cpu"
compute = "float16" if device == "cuda" else "int8"
asr = WhisperModel(os.environ.get("WHISPER_MODEL_PATH", "large-v3"), device=device, compute_type=compute, local_files_only=True)
tts = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
inference_slots = Semaphore(1)
voice_paths = {
    "female": os.environ["VOICE_FEMALE_REFERENCE"],
    "male": os.environ["VOICE_MALE_REFERENCE"],
}
if any(not Path(path).is_file() for path in voice_paths.values()):
    raise RuntimeError("Both consented voice reference files must exist before starting the service")
if Path(voice_paths["female"]).samefile(voice_paths["male"]):
    raise RuntimeError("Female and male voice references must be different consented recordings")


def authorize(value: str | None) -> None:
    if value != f"Bearer {api_key}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), model: str = Form("whisper-1"), response_format: str = Form("json"), authorization: str | None = Header(default=None), language: str | None = Form(default=None)):
    authorize(authorization)
    if language not in {None, "auto", "en", "ar"}:
        raise HTTPException(status_code=400, detail="unsupported_language")
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
        path = temporary.name
        size = 0
        while data := await file.read(1024 * 1024):
            size += len(data)
            if size > 8_000_000:
                temporary.close()
                Path(path).unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="recording_too_long")
            temporary.write(data)
    try:
        # Do not block the event loop: health checks and other cancellations still run.
        return await run_in_threadpool(transcribe_file, path, None if language == "auto" else language)
    finally:
        Path(path).unlink(missing_ok=True)


def transcribe_file(path: str, language: str | None = None):
    with inference_slots:
        segments, info = asr.transcribe(path, vad_filter=True, beam_size=5, language=language, task="transcribe")
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
    return {"text": transcript, "language": info.language}


class SpeechRequest(BaseModel):
    model: str = "chatterbox-multilingual"
    input: str
    voice: str
    language_id: str
    response_format: str = "wav"


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    if not request.input.strip() or len(request.input) > 6000:
        raise HTTPException(status_code=400, detail="invalid_speech_length")
    if request.language_id not in {"en", "ar"} or request.voice not in voice_paths:
        raise HTTPException(status_code=400, detail="unsupported_language_or_voice")
    with inference_slots:
        audio = tts.generate(request.input, language_id=request.language_id, audio_prompt_path=voice_paths[request.voice])
    # In-memory WAV avoids Windows NamedTemporaryFile sharing violations and disk copies.
    output = BytesIO()
    sf.write(output, audio.squeeze().detach().cpu().numpy(), tts.sr, format="WAV", subtype="PCM_16")
    content = output.getvalue()
    return Response(content, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/health")
def health(authorization: str | None = Header(default=None)):
    authorize(authorization)
    return {"status": "ready", "device": device, "asr": "faster-whisper", "tts": "chatterbox-multilingual"}

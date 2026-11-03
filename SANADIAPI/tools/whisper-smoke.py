import math, os, struct, wave, urllib.request

path = os.path.join(os.environ.get("TEMP", "."), "sanadi-tone.wav")
sr, n = 16000, 16000 * 2
with wave.open(path, "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    for i in range(n):
        v = int(8000 * math.sin(2 * math.pi * 440 * i / sr))
        w.writeframes(struct.pack("<h", v))

key = os.environ.get("OPENAI_API_KEY") or ""
print("keylen", len(key), "wav", os.path.getsize(path))
boundary = "----sanadi"
parts = []

def add(name: str, value: bytes | str, filename: str | None = None, ctype: str | None = None) -> None:
    parts.append(f"--{boundary}\r\n".encode())
    if filename:
        parts.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'.encode()
        )
        parts.append(f"Content-Type: {ctype}\r\n\r\n".encode())
        parts.append(value if isinstance(value, bytes) else value.encode())
        parts.append(b"\r\n")
    else:
        parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        parts.append(value.encode() if isinstance(value, str) else value)
        parts.append(b"\r\n")

add("model", "whisper-1")
add("response_format", "json")
with open(path, "rb") as f:
    add("file", f.read(), "recording.wav", "audio/wav")
parts.append(f"--{boundary}--\r\n".encode())
body = b"".join(parts)
req = urllib.request.Request("https://api.openai.com/v1/audio/transcriptions", data=body, method="POST")
req.add_header("Authorization", "Bearer " + key)
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print("whisper", r.status, r.read()[:300].decode("utf-8", "replace"))
except Exception as e:
    print("whisper_err", e)

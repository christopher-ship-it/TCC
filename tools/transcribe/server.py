#!/usr/bin/env python3
"""
Local speech-to-text sidecar for TCC call recordings.

  npm run transcribe            # then TCC shows a transcript under each recorded call

It downloads a TeleCMI recording (by file name only) and transcribes it with Whisper running on
this machine (Apple-silicon MLX build) — no API key, and the audio never leaves the laptop.
Bound to 127.0.0.1; CORS only allows localhost origins. Standard library + mlx_whisper only.

  GET  /health                        -> {ok, model, loaded}
  POST /transcribe {"file": "<name>.mp3", "language": "ta"?} -> {file, language, text, segments[{start,end,text}], model, at}
                                    (a 2-letter language hint helps a lot on short, noisy phone audio; omit it to auto-detect)

Environment (all optional):
  TRANSCRIBE_PORT=8787   TRANSCRIBE_MODEL=mlx-community/whisper-large-v3-turbo-q4
  TRANSCRIBE_ALLOW_DOWNLOAD=1   allow fetching the model from Hugging Face (default: use only the local cache)
  TELECMI_APP_ID / TELECMI_DASHBOARD_HOST   default to VITE_TELECMI_APP_ID / VITE_TELECMI_DASHBOARD_HOST in .env.local
"""
import json
import os
import re
import sys
import threading
import time
import types
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")
FILE_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,200}\.(mp3|wav|ogg|m4a)$")  # a bare file name — never a path or URL
ORIGIN_RE = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")
MAX_BYTES = 50 * 1024 * 1024


def read_env_local():
    """Non-secret settings only, from the repo's .env.local."""
    out = {}
    try:
        with open(os.path.join(ROOT, ".env.local")) as f:
            for line in f:
                m = re.match(r"^\s*(VITE_TELECMI_APP_ID|VITE_TELECMI_DASHBOARD_HOST)\s*=\s*(\S+)", line)
                if m:
                    out[m.group(1)] = m.group(2)
    except OSError:
        pass
    return out


_env = read_env_local()
PORT = int(os.environ.get("TRANSCRIBE_PORT", "8787"))
MODEL = os.environ.get("TRANSCRIBE_MODEL", "mlx-community/whisper-large-v3-turbo-q4")
APP_ID = os.environ.get("TELECMI_APP_ID") or _env.get("VITE_TELECMI_APP_ID", "")
REC_HOST = os.environ.get("TELECMI_DASHBOARD_HOST") or _env.get("VITE_TELECMI_DASHBOARD_HOST", "connle.telecmi.com")

if not os.environ.get("TRANSCRIBE_ALLOW_DOWNLOAD"):
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # use only models already on disk

_lock = threading.Lock()  # one transcription at a time (the model is not thread-safe)
_mlx = None


def whisper():
    global _mlx
    if _mlx is None:
        try:
            import scipy.signal  # noqa: F401  (only needed for word timestamps, which we don't use)
        except Exception:
            sys.modules["scipy.signal"] = types.ModuleType("scipy.signal")  # broken SciPy/NumPy pairing on some machines
        import mlx_whisper

        _mlx = mlx_whisper
    return _mlx


def download(file_name):
    if not APP_ID:
        raise ValueError("TELECMI_APP_ID is not set (VITE_TELECMI_APP_ID in .env.local)")
    url = f"https://{REC_HOST}/connly_voice/download_music/{urllib.parse.quote(file_name)}?inet_no={urllib.parse.quote(APP_ID)}"
    os.makedirs(CACHE_DIR, exist_ok=True)
    dest = os.path.join(CACHE_DIR, file_name)
    if not os.path.exists(dest):
        req = urllib.request.Request(url, headers={"User-Agent": "tcc-transcribe/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError("recording too large")
        with open(dest, "wb") as f:
            f.write(data)
    return dest


def transcribe(file_name, language=None):
    cached = os.path.join(CACHE_DIR, f"{file_name}.{language or 'auto'}.json")
    if os.path.exists(cached):
        with open(cached) as f:
            return json.load(f)
    audio = download(file_name)
    with _lock:
        out = whisper().transcribe(audio, path_or_hf_repo=MODEL, word_timestamps=False, verbose=None, language=language)
    result = {
        "file": file_name,
        "language": out.get("language"),
        "text": (out.get("text") or "").strip(),
        "segments": [{"start": round(s["start"], 2), "end": round(s["end"], 2), "text": s["text"].strip()} for s in out.get("segments", [])],
        "model": MODEL,
        "at": int(time.time() * 1000),
    }
    with open(cached, "w") as f:
        json.dump(result, f, ensure_ascii=False)
    return result


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if ORIGIN_RE.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, body):
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": MODEL, "loaded": _mlx is not None})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcribe":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(min(length, 10_000)) or b"{}")
            file_name = str(body.get("file", ""))
            if not FILE_RE.match(file_name):
                return self._json(400, {"error": "file must be a bare audio file name"})
            language = body.get("language")
            if language is not None and not re.match(r"^[a-z]{2}$", str(language)):
                return self._json(400, {"error": "language must be a 2-letter code"})
            self._json(200, transcribe(file_name, language))
        except Exception as e:  # report, don't crash the server
            print(f"[transcribe] error: {e}", file=sys.stderr)
            self._json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print("[transcribe]", fmt % args)


if __name__ == "__main__":
    print(f"[transcribe] http://127.0.0.1:{PORT}  model={MODEL}  recordings=https://{REC_HOST}  (Ctrl-C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

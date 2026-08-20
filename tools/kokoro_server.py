"""
Servidor HTTP do Kokoro TTS no mesmo contrato do piper.http_server, para a
extensao falar com os dois sem cliente separado.

    POST /synthesize   {"text": "...", "voice": "pm_alex", "speed": 1.0}  -> WAV
    POST /             corpo em text/plain                                 -> WAV
    GET  /?text=...                                                        -> WAV
    GET  /voices       lista de vozes do idioma carregado                   -> JSON
    GET  /info         idioma, voz padrao e dispositivo em uso              -> JSON

Uso:
    .venv-kokoro\\Scripts\\python.exe tools\\kokoro_server.py --port 5001
    ... --device cuda      (precisa do torch com CUDA)
    ... --lang p --voice pm_alex
"""

import argparse
import io
import json
import logging
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from kokoro import KPipeline

SAMPLE_RATE = 24000

# O catalogo do Kokoro por idioma; 'p' = portugues do Brasil.
VOICES = {
    "p": ["pm_alex", "pm_santa", "pf_dora"],
    "a": ["af_heart", "af_bella", "am_michael", "am_puck"],
    "e": ["ef_dora", "em_alex", "em_santa"],
}

log = logging.getLogger("kokoro-server")

# A inferencia nao e thread-safe: serializamos as requisicoes.
lock = threading.Lock()
pipeline = None
config = {}


def build_pipeline(lang: str, device: str):
    """Cria o pipeline, caindo para CPU se o dispositivo pedido nao servir."""
    try:
        pipe = KPipeline(lang_code=lang, device=device)
        return pipe, device
    except Exception as error:  # torch sem CUDA, VRAM insuficiente, etc.
        if device != "cpu":
            log.warning("dispositivo %s indisponivel (%s); usando CPU", device, error)
            return KPipeline(lang_code=lang, device="cpu"), "cpu"
        raise


def actual_device() -> str:
    try:
        return str(next(pipeline.model.parameters()).device)
    except Exception:
        return config.get("device", "?")


def synthesize(text: str, voice: str, speed: float) -> bytes:
    """Devolve um WAV PCM 16 bits, 24 kHz, mono."""
    with lock:
        chunks = [result.audio for result in pipeline(text, voice=voice, speed=speed)]

    if not chunks:
        raise ValueError("texto nao gerou audio")

    audio = np.concatenate([np.asarray(c.numpy() if hasattr(c, "numpy") else c, dtype=np.float32) for c in chunks])
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # silencia o log por requisicao
        pass

    # ------------------------------------------------------------------ helpers
    def _send(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload):
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

    def _audio(self, text: str, voice: str, speed: float):
        text = (text or "").strip()
        if not text:
            return self._json(400, {"error": "texto vazio"})
        voice = voice or config["voice"]
        try:
            wav = synthesize(text, voice, speed)
        except Exception as error:
            log.exception("falha ao sintetizar")
            return self._json(500, {"error": str(error)})
        self._send(200, wav, "audio/wav")

    # ------------------------------------------------------------------ rotas
    def do_GET(self):
        route = urlparse(self.path)
        if route.path.rstrip("/") == "/voices":
            return self._json(200, {"voices": VOICES.get(config["lang"], [])})
        if route.path.rstrip("/") == "/info":
            return self._json(
                200,
                {
                    "engine": "kokoro",
                    "lang": config["lang"],
                    "voice": config["voice"],
                    "device": actual_device(),
                    "sample_rate": SAMPLE_RATE,
                },
            )

        query = parse_qs(route.query)
        if "text" in query:
            return self._audio(
                query["text"][0],
                (query.get("voice") or [config["voice"]])[0],
                float((query.get("speed") or [config["speed"]])[0]),
            )
        return self._json(404, {"error": "use GET /?text=... ou POST /synthesize"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        route = urlparse(self.path).path.rstrip("/")

        if route in ("/synthesize", "/tts", "/api/tts"):
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "JSON invalido"})
            return self._audio(
                payload.get("text") or payload.get("input") or "",
                payload.get("voice") or config["voice"],
                float(payload.get("speed") or config["speed"]),
            )

        if route in ("", "/"):
            # compatibilidade com o piper.http_server: corpo em texto puro
            return self._audio(raw.decode("utf-8", "replace"), config["voice"], config["speed"])

        return self._json(404, {"error": "rota desconhecida"})


def main():
    parser = argparse.ArgumentParser(description="Servidor HTTP do Kokoro TTS")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--lang", default="p", help="p = portugues do Brasil")
    parser.add_argument("--voice", default="pm_alex")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--device", default="cpu", help="cpu ou cuda")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    global pipeline
    config.update(lang=args.lang, voice=args.voice, speed=args.speed, device=args.device)
    log.info("carregando o Kokoro (idioma %s, dispositivo %s)...", args.lang, args.device)
    pipeline, used = build_pipeline(args.lang, args.device)
    config["device"] = used

    # primeira sintese e mais lenta: aquece antes de aceitar requisicoes
    synthesize("ok", args.voice, 1.0)
    log.info("Kokoro no ar em http://%s:%s (voz %s, %s)", args.host, args.port, args.voice, actual_device())

    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()

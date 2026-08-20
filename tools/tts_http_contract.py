"""
Contrato HTTP compartilhado pelos servidores de TTS local (Template Method).

O Kokoro e o F5-TTS expunham exatamente as mesmas rotas, com as mesmas regras de
cabecalho, os mesmos codigos de erro e o mesmo tratamento de corpo. As duas
classes Handler eram copia uma da outra: _send, _json, _audio, do_GET e do_POST
identicos, so mudando o motor chamado no meio.

Aqui fica o esqueleto. Cada servidor implementa apenas o que e proprio dele:

    synthesize(text, voice, speed) -> bytes    WAV pronto
    list_voices() -> list[str]                 o que /voices devolve
    describe() -> dict                         o que /info devolve

As rotas atendidas, iguais para todos os motores:

    POST /synthesize   {"text": "...", "voice": "...", "speed": 1.0}  -> WAV
    POST /             corpo em text/plain                            -> WAV
    GET  /?text=...                                                   -> WAV
    GET  /voices                                                      -> JSON
    GET  /info                                                        -> JSON

A compatibilidade com o piper.http_server (POST / com texto puro) e mantida de
proposito: e o que permite a extensao falar com os tres motores usando um
cliente so.
"""

import io
import json
import logging
import wave
from abc import ABC, abstractmethod
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np

# rotas alternativas aceitas em POST, por compatibilidade com outros servidores
SYNTHESIZE_ROUTES = ("/synthesize", "/tts", "/api/tts")


class TtsEngine(ABC):
    """O que cada motor precisa fornecer para virar um servidor."""

    #: nome curto, devolvido em /info
    name: str = "tts"
    #: voz usada quando a requisicao nao especifica
    default_voice: str = ""
    #: velocidade usada quando a requisicao nao especifica
    default_speed: float = 1.0

    @abstractmethod
    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        """Devolve um WAV completo, pronto para ir no corpo da resposta."""

    @abstractmethod
    def list_voices(self) -> list:
        """Vozes disponiveis, para GET /voices."""

    @abstractmethod
    def describe(self) -> dict:
        """Estado do motor (dispositivo, modelo, idioma), para GET /info."""


def pcm_to_wav(samples: "np.ndarray", sample_rate: int) -> bytes:
    """
    Converte amostras float em WAV PCM 16 bits mono.

    O clip antes da conversao nao e detalhe: sem ele, amostras acima de 1.0
    estouram o inteiro de 16 bits e voltam como ruido audivel no lugar da fala.
    """
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype("<i2")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def build_handler(engine: TtsEngine, log: logging.Logger):
    """Cria a classe de handler ligada a um motor."""

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # silencia o log por requisicao
            pass

        # -------------------------------------------------------------- helpers

        def _send(self, status: int, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            # a extensao chama de outra origem: sem isso o navegador barra
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, payload: Any):
            self._send(status, json.dumps(payload).encode("utf-8"), "application/json")

        def _audio(self, text: str, voice: str, speed: float):
            text = (text or "").strip()
            if not text:
                return self._json(400, {"error": "texto vazio"})

            try:
                wav = engine.synthesize(text, voice or engine.default_voice, speed)
            except ValueError as error:
                # entrada invalida: e culpa de quem chamou
                return self._json(400, {"error": str(error)})
            except Exception as error:  # noqa: BLE001 - a falha vai para o log
                log.exception("falha ao sintetizar")
                return self._json(500, {"error": str(error)})

            self._send(200, wav, "audio/wav")

        def _first(self, query: dict, key: str, fallback):
            values = query.get(key)
            return values[0] if values else fallback

        # ---------------------------------------------------------------- rotas

        def do_GET(self):
            route = urlparse(self.path)
            path = route.path.rstrip("/")

            if path == "/voices":
                return self._json(200, {"voices": engine.list_voices()})
            if path == "/info":
                return self._json(200, engine.describe())

            query = parse_qs(route.query)
            if "text" in query:
                return self._audio(
                    self._first(query, "text", ""),
                    self._first(query, "voice", engine.default_voice),
                    float(self._first(query, "speed", engine.default_speed)),
                )

            return self._json(404, {"error": "use GET /?text=... ou POST /synthesize"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            path = urlparse(self.path).path.rstrip("/")

            if path in SYNTHESIZE_ROUTES:
                try:
                    payload = json.loads(raw.decode("utf-8") or "{}")
                except json.JSONDecodeError:
                    return self._json(400, {"error": "JSON invalido"})

                return self._audio(
                    # input e o nome do campo na API da OpenAI
                    payload.get("text") or payload.get("input") or "",
                    payload.get("voice") or engine.default_voice,
                    float(payload.get("speed") or engine.default_speed),
                )

            if path == "":
                # compatibilidade com o piper.http_server: corpo em texto puro
                return self._audio(
                    raw.decode("utf-8", "replace"), engine.default_voice, engine.default_speed
                )

            return self._json(404, {"error": "rota desconhecida"})

    return Handler


def serve(engine: TtsEngine, host: str, port: int, log: logging.Logger):
    """Sobe o servidor e bloqueia."""
    ThreadingHTTPServer((host, port), build_handler(engine, log)).serve_forever()

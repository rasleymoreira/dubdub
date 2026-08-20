"""
Servidor HTTP do Kokoro TTS.

As rotas e o formato de resposta vem de tts_http_contract; aqui fica so o que e
proprio do Kokoro. O contrato compartilhado e o mesmo do piper.http_server, o
que permite a extensao falar com os tres motores locais usando um cliente so.

Uso:
    .venv-kokoro\\Scripts\\python.exe tools\\kokoro_server.py --port 5001
    ... --device cuda      (precisa do torch com CUDA)
    ... --lang p --voice pm_alex
"""

import argparse
import logging
import threading

import numpy as np
from kokoro import KPipeline

from tts_http_contract import TtsEngine, pcm_to_wav, serve

SAMPLE_RATE = 24000

# O catalogo do Kokoro por idioma; p = portugues do Brasil.
VOICES = {
    "p": ["pm_alex", "pm_santa", "pf_dora"],
    "a": ["af_heart", "af_bella", "am_michael", "am_puck"],
    "e": ["ef_dora", "em_alex", "em_santa"],
}

log = logging.getLogger("kokoro-server")


class KokoroEngine(TtsEngine):
    name = "kokoro"

    def __init__(self, lang: str, voice: str, speed: float, device: str):
        self.lang = lang
        self.default_voice = voice
        self.default_speed = speed
        # a inferencia nao e thread-safe: serializamos as requisicoes
        self._lock = threading.Lock()
        self._pipeline, self.device = self._build(lang, device)

    def _build(self, lang: str, device: str):
        """Cria o pipeline, caindo para CPU se o dispositivo pedido nao servir."""
        try:
            return KPipeline(lang_code=lang, device=device), device
        except Exception as error:  # noqa: BLE001 - torch sem CUDA, VRAM insuficiente
            if device == "cpu":
                raise
            log.warning("dispositivo %s indisponivel (%s); usando CPU", device, error)
            return KPipeline(lang_code=lang, device="cpu"), "cpu"

    def actual_device(self) -> str:
        try:
            return str(next(self._pipeline.model.parameters()).device)
        except Exception:  # noqa: BLE001 - so informativo
            return self.device

    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        with self._lock:
            chunks = [result.audio for result in self._pipeline(text, voice=voice, speed=speed)]

        if not chunks:
            raise ValueError("texto nao gerou audio")

        audio = np.concatenate(
            [
                np.asarray(chunk.numpy() if hasattr(chunk, "numpy") else chunk, dtype=np.float32)
                for chunk in chunks
            ]
        )
        return pcm_to_wav(audio, SAMPLE_RATE)

    def list_voices(self) -> list:
        return VOICES.get(self.lang, [])

    def describe(self) -> dict:
        return {
            "engine": self.name,
            "lang": self.lang,
            "voice": self.default_voice,
            "device": self.actual_device(),
            "sample_rate": SAMPLE_RATE,
        }


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
    log.info("carregando o Kokoro (idioma %s, dispositivo %s)...", args.lang, args.device)

    engine = KokoroEngine(args.lang, args.voice, args.speed, args.device)

    # a primeira sintese e bem mais lenta: aquece antes de aceitar requisicoes
    engine.synthesize("ok", args.voice, 1.0)
    log.info(
        "Kokoro no ar em http://%s:%s (voz %s, %s)",
        args.host,
        args.port,
        args.voice,
        engine.actual_device(),
    )

    serve(engine, args.host, args.port, log)


if __name__ == "__main__":
    main()

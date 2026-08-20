"""
Servidor HTTP do F5-TTS no mesmo contrato do piper.http_server e do
kokoro_server, para a extensao falar com todos sem cliente separado.

    POST /synthesize   {"text": "...", "voice": "nome", "speed": 1.0}  -> WAV
    POST /             corpo em text/plain                             -> WAV
    GET  /?text=...                                                    -> WAV
    GET  /voices       referencias disponiveis                         -> JSON
    GET  /info         modelo, dispositivo e referencia em uso         -> JSON

O F5-TTS clona a voz de um audio de referencia, entao aqui "voz" = um par de
arquivos em models/f5-ref/:

    models/f5-ref/heitor.wav   5 a 15 segundos de fala limpa
    models/f5-ref/heitor.txt   a transcricao exata desse audio

Uso:
    .venv-f5\\Scripts\\python.exe tools\\f5_server.py --port 5002 --device cuda
"""

import argparse
import io
import json
import logging
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "models" / "f5-ref"

log = logging.getLogger("f5-server")

lock = threading.Lock()  # a inferencia nao e thread-safe
model = None
config = {}


def patch_torchaudio_if_needed(probe: Path):
    """
    O torchaudio 2.9+ delega leitura de audio ao torchcodec, que no Windows
    exige as DLLs do FFmpeg. Quando isso falha, trocamos por soundfile, que ja
    vem instalado e cobre o unico uso do F5 aqui: ler o audio de referencia.
    """
    import torch
    import torchaudio

    if probe and probe.is_file():
        try:
            torchaudio.load(str(probe))
            log.info("leitura de audio: torchaudio nativo")
            return
        except Exception as error:
            log.warning("torchaudio nao consegue ler audio (%s); usando soundfile", type(error).__name__)

    import soundfile as sf

    def load(uri, frame_offset=0, num_frames=-1, normalize=True, channels_first=True, **kwargs):
        data, rate = sf.read(
            str(uri),
            dtype="float32",
            always_2d=True,
            start=frame_offset,
            frames=num_frames if num_frames and num_frames > 0 else -1,
        )
        return torch.from_numpy(data.T if channels_first else data), rate

    def save(uri, src, sample_rate, **kwargs):
        array = src.detach().cpu().numpy()
        sf.write(str(uri), array.T if array.ndim > 1 else array, int(sample_rate))

    torchaudio.load = load
    torchaudio.save = save
    log.info("leitura de audio: soundfile")


def list_refs():
    """Referencias validas: .wav com .txt do mesmo nome ao lado."""
    if not REF_DIR.is_dir():
        return {}
    refs = {}
    for wav in sorted(REF_DIR.glob("*.wav")):
        txt = wav.with_suffix(".txt")
        if txt.is_file():
            refs[wav.stem] = (wav, txt.read_text(encoding="utf-8").strip())
    return refs


def synthesize(text: str, voice: str, speed: float) -> bytes:
    refs = list_refs()
    if not refs:
        raise FileNotFoundError(
            f"nenhuma referencia em {REF_DIR}. Coloque um par nome.wav + nome.txt "
            "(5 a 15s de fala limpa e a transcricao exata)."
        )
    if voice not in refs:
        raise KeyError(f"referencia '{voice}' nao existe. Disponiveis: {', '.join(refs)}")

    ref_wav, ref_text = refs[voice]

    # o checkpoint pt-br foi treinado em minusculas
    gen_text = text.lower() if config["lower"] else text

    with lock:
        wav, sample_rate, _ = model.infer(
            ref_file=str(ref_wav),
            # o alinhamento da referencia segue a mesma caixa do texto gerado
            ref_text=ref_text.lower() if config["lower"] else ref_text,
            gen_text=gen_text,
            speed=speed,
            nfe_step=config["nfe"],
            remove_silence=False,
        )

    audio = np.asarray(wav, dtype=np.float32)
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(int(sample_rate))
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

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
        try:
            wav = synthesize(text, voice or config["voice"], speed)
        except (FileNotFoundError, KeyError) as error:
            return self._json(400, {"error": str(error)})
        except Exception as error:
            log.exception("falha ao sintetizar")
            return self._json(500, {"error": str(error)})
        self._send(200, wav, "audio/wav")

    def do_GET(self):
        route = urlparse(self.path)
        path = route.path.rstrip("/")

        if path == "/voices":
            return self._json(200, {"voices": list(list_refs())})
        if path == "/info":
            return self._json(
                200,
                {
                    "engine": "f5-tts",
                    "device": config["device"],
                    "voice": config["voice"],
                    "nfe_step": config["nfe"],
                    "refs": list(list_refs()),
                    "ckpt": config["ckpt"],
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
        path = urlparse(self.path).path.rstrip("/")

        if path in ("/synthesize", "/tts", "/api/tts"):
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "JSON invalido"})
            return self._audio(
                payload.get("text") or payload.get("input") or "",
                payload.get("voice") or config["voice"],
                float(payload.get("speed") or config["speed"]),
            )

        if path in ("", "/"):
            return self._audio(raw.decode("utf-8", "replace"), config["voice"], config["speed"])

        return self._json(404, {"error": "rota desconhecida"})


def main():
    parser = argparse.ArgumentParser(description="Servidor HTTP do F5-TTS")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5002)
    parser.add_argument("--voice", default="", help="referencia padrao (nome do arquivo sem extensao)")
    parser.add_argument("--ckpt", default=str(ROOT / "models" / "f5-pt-br" / "model_last.safetensors"))
    parser.add_argument("--vocab", default="", help="vocab.txt proprio, se o checkpoint tiver")
    parser.add_argument("--model", default="F5TTS_Base", help="arquitetura do checkpoint")
    parser.add_argument("--device", default="cuda", help="cuda ou cpu")
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--nfe", type=int, default=32, help="passos de inferencia; menos = mais rapido")
    parser.add_argument("--keep-case", action="store_true", help="nao converte o texto para minusculas")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    refs = list_refs()
    if not refs:
        log.error("nenhuma referencia em %s — o servidor sobe, mas toda sintese vai falhar", REF_DIR)
    voice = args.voice or (next(iter(refs)) if refs else "")

    import torch

    patch_torchaudio_if_needed(refs[voice][0] if voice in refs else None)
    from f5_tts.api import F5TTS

    device = args.device
    if device == "cuda" and not torch.cuda.is_available():
        log.warning("torch sem CUDA: usando CPU (vai ficar lento)")
        device = "cpu"

    config.update(
        voice=voice,
        speed=args.speed,
        nfe=args.nfe,
        device=device,
        lower=not args.keep_case,
        ckpt=args.ckpt,
    )

    log.info("carregando o F5-TTS (%s em %s)...", Path(args.ckpt).name, device)
    global model
    model = F5TTS(
        model=args.model,
        ckpt_file=args.ckpt,
        vocab_file=args.vocab,
        device=device,
    )

    if refs:
        synthesize("ok", voice, 1.0)  # aquece antes de aceitar requisicoes
    log.info("F5-TTS no ar em http://%s:%s (referencia %s, %s)", args.host, args.port, voice or "-", device)

    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()

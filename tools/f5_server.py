"""
Servidor HTTP do F5-TTS.

As rotas e o formato de resposta vem de tts_http_contract; aqui fica so o que e
proprio do F5. O contrato compartilhado e o mesmo do piper.http_server, o que
permite a extensao falar com os tres motores locais usando um cliente so.

O F5 clona a voz de um audio de referencia, entao aqui "voz" e um par de
arquivos em models/f5-ref/:

    models/f5-ref/heitor.wav   5 a 15 segundos de fala limpa
    models/f5-ref/heitor.txt   a transcricao exata desse audio

A qualidade da dublagem depende diretamente da referencia: audio limpo, uma so
pessoa falando, sem eco, e o .txt batendo palavra por palavra com o audio.

Uso:
    .venv-f5\\Scripts\\python.exe tools\\f5_server.py --port 5002 --device cuda
"""

import argparse
import logging
from pathlib import Path

import numpy as np
import threading

from tts_http_contract import TtsEngine, pcm_to_wav, serve

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "models" / "f5-ref"

log = logging.getLogger("f5-server")


def patch_torchaudio_if_needed(probe: Path | None):
    """
    O torchaudio 2.9+ delega a leitura de audio ao torchcodec, que no Windows
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
        except Exception as error:  # noqa: BLE001 - qualquer falha cai para soundfile
            log.warning(
                "torchaudio nao consegue ler audio (%s); usando soundfile", type(error).__name__
            )

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


def list_refs() -> dict:
    """Referencias validas: .wav com um .txt de mesmo nome ao lado."""
    if not REF_DIR.is_dir():
        return {}

    refs = {}
    for wav in sorted(REF_DIR.glob("*.wav")):
        txt = wav.with_suffix(".txt")
        if txt.is_file():
            refs[wav.stem] = (wav, txt.read_text(encoding="utf-8").strip())
    return refs


class F5Engine(TtsEngine):
    name = "f5-tts"

    def __init__(self, model, voice: str, speed: float, nfe: int, device: str, lower: bool, ckpt: str):
        self._model = model
        self.default_voice = voice
        self.default_speed = speed
        self.nfe = nfe
        self.device = device
        self.lower = lower
        self.ckpt = ckpt
        # a inferencia nao e thread-safe: serializamos as requisicoes
        self._lock = threading.Lock()

    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        refs = list_refs()
        if not refs:
            raise ValueError(
                f"nenhuma referencia em {REF_DIR}. Coloque um par nome.wav + nome.txt "
                "(5 a 15s de fala limpa e a transcricao exata)."
            )
        if voice not in refs:
            raise ValueError(
                f"referencia '{voice}' nao existe. Disponiveis: {', '.join(refs)}"
            )

        ref_wav, ref_text = refs[voice]

        # o checkpoint pt-br foi treinado em minusculas; o alinhamento da
        # referencia precisa seguir a mesma caixa do texto gerado
        gen_text = text.lower() if self.lower else text
        ref_aligned = ref_text.lower() if self.lower else ref_text

        with self._lock:
            wav, sample_rate, _ = self._model.infer(
                ref_file=str(ref_wav),
                ref_text=ref_aligned,
                gen_text=gen_text,
                speed=speed,
                nfe_step=self.nfe,
                remove_silence=False,
            )

        return pcm_to_wav(np.asarray(wav, dtype=np.float32), int(sample_rate))

    def list_voices(self) -> list:
        return list(list_refs())

    def describe(self) -> dict:
        return {
            "engine": self.name,
            "device": self.device,
            "voice": self.default_voice,
            "nfe_step": self.nfe,
            "refs": list(list_refs()),
            "ckpt": self.ckpt,
        }


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
        log.error("nenhuma referencia em %s: o servidor sobe, mas toda sintese vai falhar", REF_DIR)
    voice = args.voice or (next(iter(refs)) if refs else "")

    import torch

    patch_torchaudio_if_needed(refs[voice][0] if voice in refs else None)
    from f5_tts.api import F5TTS

    device = args.device
    if device == "cuda" and not torch.cuda.is_available():
        log.warning("torch sem CUDA: usando CPU (vai ficar lento)")
        device = "cpu"

    log.info("carregando o F5-TTS (%s em %s)...", Path(args.ckpt).name, device)
    model = F5TTS(model=args.model, ckpt_file=args.ckpt, vocab_file=args.vocab, device=device)

    engine = F5Engine(
        model=model,
        voice=voice,
        speed=args.speed,
        nfe=args.nfe,
        device=device,
        lower=not args.keep_case,
        ckpt=args.ckpt,
    )

    # a primeira sintese carrega o vocoder: aquece antes de aceitar requisicoes
    if refs:
        engine.synthesize("ok", voice, 1.0)

    log.info(
        "F5-TTS no ar em http://%s:%s (referencia %s, %s)",
        args.host,
        args.port,
        voice or "-",
        device,
    )

    serve(engine, args.host, args.port, log)


if __name__ == "__main__":
    main()

/*
 * Native messaging host: liga e desliga os servidores de TTS local (Piper e
 * Kokoro) a pedido da extensao.
 *
 * O Chrome executa este processo, envia UMA mensagem (4 bytes de tamanho em
 * little-endian + JSON em UTF-8), le a resposta no mesmo formato e encerra.
 *
 * Acoes aceitas:
 *   { action: 'status', engine: 'piper'|'kokoro', port }
 *   { action: 'start',  engine, voice, port, cuda }
 *   { action: 'stop',   engine, port }
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MODELS = path.join(ROOT, 'models');
const VOICE_RE = /^[\p{L}\p{N}_-]+$/u;

const ENGINES = {
  f5: {
    label: 'F5-TTS',
    python: path.join(ROOT, '.venv-f5', 'Scripts', 'python.exe'),
    pidFile: path.join(ROOT, '.f5.pid'),
    log: path.join(ROOT, 'f5-server.log'),
    defaultPort: 5002,
    defaultVoice: '',
    // sem voz definida o servidor usa a primeira referencia de models/f5-ref
    allowEmptyVoice: true,
    // carrega ~1,3 GB de checkpoint
    startTimeoutMs: 240000,
    setupHint: 'Rode tools\\install-f5.ps1 uma vez.',
    voiceProblem: () => null,
    args: ({ voice, port, cuda }) => {
      const list = [path.join(ROOT, 'tools', 'f5_server.py'), '--port', String(port)];
      if (voice) list.push('--voice', voice);
      list.push('--device', cuda ? 'cuda' : 'cpu');
      return list;
    }
  },
  piper: {
    label: 'Piper',
    python: path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    pidFile: path.join(ROOT, '.piper.pid'),
    log: path.join(ROOT, 'piper-server.log'),
    defaultPort: 5000,
    defaultVoice: 'pt_BR-faber-medium',
    startTimeoutMs: 25000,
    setupHint: 'Rode tools\\start-piper.ps1 uma vez para criar o .venv.',
    voiceProblem: (voice) =>
      fs.existsSync(path.join(MODELS, voice + '.onnx'))
        ? null
        : 'Voz ' + voice + ' nao baixada. Rode: .venv\\Scripts\\python.exe -m piper.download_voices ' +
          voice + ' --download-dir models',
    args: ({ voice, port, cuda }) => {
      const list = ['-m', 'piper.http_server', '-m', voice, '--data-dir', MODELS, '--port', String(port)];
      if (cuda) list.push('--cuda');
      return list;
    }
  },
  kokoro: {
    label: 'Kokoro',
    python: path.join(ROOT, '.venv-kokoro', 'Scripts', 'python.exe'),
    pidFile: path.join(ROOT, '.kokoro.pid'),
    log: path.join(ROOT, 'kokoro-server.log'),
    defaultPort: 5001,
    defaultVoice: 'pm_alex',
    // primeira execucao baixa o modelo (~330 MB)
    startTimeoutMs: 180000,
    setupHint:
      'Crie o ambiente: py -3.12 -m venv .venv-kokoro e ' +
      '.venv-kokoro\\Scripts\\python.exe -m pip install kokoro soundfile',
    voiceProblem: () => null,
    args: ({ voice, port, cuda }) => {
      const list = [path.join(ROOT, 'tools', 'kokoro_server.py'), '--port', String(port), '--voice', voice];
      if (cuda) list.push('--device', 'cuda');
      return list;
    }
  }
};

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]), () => process.exit(0));
}

function validPort(value, fallback) {
  const port = Number(value) || fallback;
  return port >= 1024 && port <= 65535 ? port : fallback;
}

/** O servidor esta no ar? Perguntamos a ele, nao ao PID. */
async function isUp(port) {
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/voices', {
      signal: AbortSignal.timeout(1500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Quem esta escutando a porta (cobre servidores iniciados fora da extensao). */
function pidOnPort(port) {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      const match = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
      if (match && Number(match[1]) === port) return Number(match[2]);
    }
  } catch {
    /* netstat indisponivel */
  }
  return null;
}

/**
 * O arquivo guarda "pid porta": sem a porta nao da para saber se o processo
 * anotado e o que atende a porta pedida, e um stop poderia matar outra
 * instancia do mesmo motor rodando em porta diferente.
 */
function readPid(engine, port) {
  try {
    const [rawPid, rawPort] = fs.readFileSync(engine.pidFile, 'utf8').trim().split(/\s+/);
    const pid = Number(rawPid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    // formato antigo (so o pid) continua valendo para a porta padrao
    const anotada = rawPort === undefined ? engine.defaultPort : Number(rawPort);
    return anotada === port ? pid : null;
  } catch {
    return null;
  }
}

function writePid(engine, pid, port) {
  fs.writeFileSync(engine.pidFile, pid + ' ' + port);
}

function kill(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return true;
  } catch {
    try {
      process.kill(pid);
      return true;
    } catch {
      return false;
    }
  }
}

async function start(engine, { voice, port, cuda }) {
  if (await isUp(port)) return { ok: true, running: true, already: true, port };

  if (!fs.existsSync(engine.python)) {
    return { ok: false, error: 'Ambiente do ' + engine.label + ' nao encontrado. ' + engine.setupHint };
  }
  const emptyOk = engine.allowEmptyVoice && !voice;
  if (!emptyOk && !VOICE_RE.test(voice || '')) {
    return { ok: false, error: 'Nome de voz invalido: ' + voice };
  }

  const problem = engine.voiceProblem(voice);
  if (problem) return { ok: false, error: problem };

  const log = fs.openSync(engine.log, 'a');
  const child = spawn(engine.python, engine.args({ voice, port, cuda }), {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
    env: Object.assign({}, process.env, { PYTHONUTF8: '1' })
  });
  child.unref();
  writePid(engine, child.pid, port);

  const deadline = Date.now() + engine.startTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await isUp(port)) return { ok: true, running: true, pid: child.pid, voice, port };
  }
  return {
    ok: false,
    error:
      'O ' + engine.label + ' subiu mas nao respondeu em ' +
      Math.round(engine.startTimeoutMs / 1000) + 's. Veja ' + path.basename(engine.log) + '.'
  };
}

async function stop(engine, { port }) {
  const pid = readPid(engine, port) || pidOnPort(port);
  if (!pid) {
    const running = await isUp(port);
    return running
      ? { ok: false, error: 'Servidor no ar mas nao consegui identificar o processo.' }
      : { ok: true, running: false, already: true };
  }

  kill(pid);
  try {
    fs.unlinkSync(engine.pidFile);
  } catch {
    /* ja nao existia */
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    if (!(await isUp(port))) return { ok: true, running: false, pid };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, error: 'Nao consegui encerrar o processo ' + pid };
}

async function handle(message) {
  const engine = ENGINES[message.engine] || ENGINES.piper;
  const port = validPort(message.port, engine.defaultPort);
  const voice = message.voice || engine.defaultVoice;

  switch (message.action) {
    case 'start':
      return start(engine, { voice, port, cuda: Boolean(message.cuda) });
    case 'stop':
      return stop(engine, { port });
    case 'status':
    default: {
      const running = await isUp(port);
      return {
        ok: true,
        engine: engine.label,
        running,
        port,
        pid: running ? readPid(engine, port) || pidOnPort(port) : null
      };
    }
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (buffer.length < 4) return;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return;

  let message;
  try {
    message = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
  } catch (error) {
    return send({ ok: false, error: 'mensagem invalida: ' + error.message });
  }
  buffer = Buffer.alloc(0);
  handle(message).then(send, (error) => send({ ok: false, error: String(error.message || error) }));
});

process.stdin.on('end', () => process.exit(0));

/*
 * Native messaging host: liga e desliga os servidores de TTS local.
 *
 * O Chrome executa este processo, envia UMA mensagem (4 bytes de tamanho em
 * little-endian mais JSON em UTF-8), le a resposta no mesmo formato e encerra.
 *
 * Acoes aceitas:
 *   { action: 'status', engine: 'piper'|'kokoro'|'f5', port }
 *   { action: 'start',  engine, voice, port, cuda }
 *   { action: 'stop',   engine, port }
 *
 * A tabela de motores NAO mora aqui. Ela e gerada pelo build a partir de
 * src/infrastructure/catalog/engines.catalog.ts, que e a fonte unica do
 * projeto. Este processo roda fora do bundle (o Chrome o lanca direto com o
 * Node do sistema), entao nao pode importar TypeScript: le o JSON.
 *
 * Rode `npm run build` antes de usar, ou o arquivo nao existe.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MODELS = path.join(ROOT, 'models');
const CATALOG_FILE = path.join(__dirname, 'engines.generated.json');

/** Nome de voz e interpolado em linha de comando: so caracteres inofensivos. */
const VOICE_PATTERN = /^[\p{L}\p{N}_-]+$/u;

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  } catch (error) {
    return { __error: 'catalogo de motores ausente. Rode npm run build. ' + error.message };
  }
}

const CATALOG = loadCatalog();

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

function interpolate(args, values) {
  return args.map((arg) =>
    arg.replace(/\{(voice|port|models)\}/g, (_, name) => String(values[name]))
  );
}

/** Monta a linha de comando a partir do descritor gerado. */
function buildArgs(descriptor, { voice, port, cuda }) {
  const values = { voice, port, models: MODELS };
  const args = [];

  if (descriptor.launch.kind === 'module') args.push('-m', descriptor.launch.target);
  else args.push(path.join(ROOT, descriptor.launch.target));

  if (voice) args.push(...interpolate(descriptor.voiceArgs, values));
  args.push(...interpolate(descriptor.args, values));
  args.push(...interpolate(cuda ? descriptor.cudaArgs : descriptor.cpuArgs, values));

  return args;
}

function pythonFor(descriptor) {
  return path.join(ROOT, descriptor.venv, 'Scripts', 'python.exe');
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

/** Quem escuta a porta: cobre servidores iniciados fora da extensao. */
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
 * O arquivo guarda "pid porta". Sem a porta nao daria para saber se o processo
 * anotado e o que atende a porta pedida, e um stop poderia matar outra
 * instancia do mesmo motor rodando em porta diferente.
 */
function readPid(descriptor, port) {
  try {
    const file = path.join(ROOT, descriptor.pidFile);
    const [rawPid, rawPort] = fs.readFileSync(file, 'utf8').trim().split(/\s+/);
    const pid = Number(rawPid);
    if (!Number.isInteger(pid) || pid <= 0) return null;

    // formato antigo (so o pid) continua valendo para a porta padrao
    const anotada = rawPort === undefined ? descriptor.defaultPort : Number(rawPort);
    return anotada === port ? pid : null;
  } catch {
    return null;
  }
}

function writePid(descriptor, pid, port) {
  fs.writeFileSync(path.join(ROOT, descriptor.pidFile), pid + ' ' + port);
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

/** O modelo da voz existe em disco? So o Piper declara isso. */
function voiceProblem(descriptor, voice) {
  if (!descriptor.voiceModelPath || !voice) return null;
  const relative = descriptor.voiceModelPath.replace('{voice}', voice);
  if (fs.existsSync(path.join(ROOT, relative))) return null;
  return (descriptor.voiceMissingHint || 'Voz {voice} nao encontrada.').replace(
    /\{voice\}/g,
    voice
  );
}

async function start(descriptor, { voice, port, cuda }) {
  if (await isUp(port)) return { ok: true, running: true, already: true, port };

  const python = pythonFor(descriptor);
  if (!fs.existsSync(python)) {
    return { ok: false, error: 'Ambiente do ' + descriptor.label + ' nao encontrado. ' + descriptor.setupHint };
  }

  const emptyOk = descriptor.allowEmptyVoice && !voice;
  if (!emptyOk && !VOICE_PATTERN.test(voice || '')) {
    return { ok: false, error: 'Nome de voz invalido: ' + voice };
  }

  const problem = voiceProblem(descriptor, voice);
  if (problem) return { ok: false, error: problem };

  const log = fs.openSync(path.join(ROOT, descriptor.logFile), 'a');
  const child = spawn(python, buildArgs(descriptor, { voice, port, cuda }), {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
    env: Object.assign({}, process.env, { PYTHONUTF8: '1' })
  });
  child.unref();
  writePid(descriptor, child.pid, port);

  const deadline = Date.now() + descriptor.startTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await isUp(port)) return { ok: true, running: true, pid: child.pid, voice, port };
  }

  return {
    ok: false,
    error:
      'O ' + descriptor.label + ' subiu mas nao respondeu em ' +
      Math.round(descriptor.startTimeoutMs / 1000) + 's. Veja ' + descriptor.logFile + '.'
  };
}

async function stop(descriptor, { port }) {
  const pid = readPid(descriptor, port) || pidOnPort(port);
  if (!pid) {
    const running = await isUp(port);
    return running
      ? { ok: false, error: 'Servidor no ar mas nao consegui identificar o processo.' }
      : { ok: true, running: false, already: true };
  }

  kill(pid);
  try {
    fs.unlinkSync(path.join(ROOT, descriptor.pidFile));
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
  if (CATALOG.__error) return { ok: false, error: CATALOG.__error };

  const descriptor = CATALOG[message.engine] || CATALOG.piper;
  if (!descriptor) return { ok: false, error: 'motor desconhecido: ' + message.engine };

  const port = validPort(message.port, descriptor.defaultPort);
  const voice = message.voice || descriptor.defaultVoice;

  switch (message.action) {
    case 'start':
      return start(descriptor, { voice, port, cuda: Boolean(message.cuda) });
    case 'stop':
      return stop(descriptor, { port });
    case 'status':
    default: {
      const running = await isUp(port);
      return {
        ok: true,
        engine: descriptor.label,
        running,
        port,
        pid: running ? readPid(descriptor, port) || pidOnPort(port) : null
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

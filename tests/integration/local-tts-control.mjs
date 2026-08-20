/*
 * Testa o host de native messaging que liga/desliga os servidores de TTS local,
 * falando o mesmo protocolo que o navegador usa (4 bytes de tamanho + JSON).
 *
 *   node tests/local-tts-control.js              # piper
 *   ENGINE=kokoro node tests/local-tts-control.js
 *   ENGINE=f5 PORT=5002 node tests/local-tts-control.js
 *
 * ATENCAO: este teste desliga e religa o servidor de verdade.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = path.join(ROOT, 'tools', 'native-host', 'host.cjs');

const DEFAULTS = {
  piper: { port: 5000, voice: 'pt_BR-faber-medium' },
  kokoro: { port: 5001, voice: 'pm_alex' },
  f5: { port: 5002, voice: '' }
};

const ENGINE = process.env.ENGINE || 'piper';
if (!DEFAULTS[ENGINE]) {
  console.error('ENGINE deve ser piper, kokoro ou f5');
  process.exit(2);
}
const PORT = Number(process.env.PORT) || DEFAULTS[ENGINE].port;
const VOICE = process.env.VOICE ?? DEFAULTS[ENGINE].voice;

let fails = 0;
function check(name, condition, extra) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name + (extra ? ' -> ' + extra : ''));
  if (!condition) fails++;
}

function call(message) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'pipe'] });
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.write(Buffer.concat([header, body]));

    const chunks = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, 300000);

    child.on('close', () => {
      clearTimeout(timer);
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 4)
        return reject(new Error('resposta vazia. stderr: ' + stderr.slice(0, 300)));
      const length = buffer.readUInt32LE(0);
      resolve(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')));
    });
  });
}

console.log('motor:', ENGINE, '| porta:', PORT, '| voz:', VOICE || '(padrao do servidor)');

const inicial = await call({ action: 'status', engine: ENGINE, port: PORT });
check(
  'status responde no formato esperado',
  inicial.ok === true && 'running' in inicial,
  JSON.stringify(inicial)
);

if (inicial.running) {
  const parado = await call({ action: 'stop', engine: ENGINE, port: PORT });
  check(
    'stop desliga o servidor',
    parado.ok === true && parado.running === false,
    JSON.stringify(parado)
  );
  check(
    'status confirma desligado',
    (await call({ action: 'status', engine: ENGINE, port: PORT })).running === false
  );
}

const ligado = await call({ action: 'start', engine: ENGINE, voice: VOICE, port: PORT });
check(
  'start sobe o servidor',
  ligado.ok === true && ligado.running === true,
  JSON.stringify(ligado)
);

const rodando = await call({ action: 'status', engine: ENGINE, port: PORT });
check('status confirma ligado', rodando.running === true, 'pid=' + rodando.pid);

const denovo = await call({ action: 'start', engine: ENGINE, voice: VOICE, port: PORT });
check('start com servidor ja no ar nao duplica', denovo.already === true, JSON.stringify(denovo));

const invalida = await call({
  action: 'start',
  engine: ENGINE,
  voice: 'nao; existe',
  port: PORT + 100
});
check('recusa nome de voz invalido', invalida.ok === false, invalida.error);

console.log(fails ? '\n' + fails + ' falha(s)' : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);

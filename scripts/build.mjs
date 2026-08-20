/*
 * Build da extensao com esbuild.
 *
 * Gera build/ como uma extensao completa e carregavel: manifest, icones,
 * popup e os tres bundles. Cada contexto de execucao do Chrome tem exigencias
 * diferentes de formato, e e por isso que sao tres entradas e nao uma:
 *
 *   service-worker  ESM   o manifest declara "type": "module"
 *   content         IIFE  content script e script classico, sem import
 *   popup           IIFE  evita depender de <script type="module">
 *
 * O bundle unico do content script substitui a lista ordenada de 5 arquivos
 * que o manifest carregava antes (a ordem era o que fazia globalThis.UDUB
 * existir a tempo).
 *
 *   node scripts/build.mjs            build unico
 *   node scripts/build.mjs --watch    rebuild a cada alteracao
 */

import { build, context } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build');
const WATCH = process.argv.includes('--watch');

const shared = {
  bundle: true,
  target: ['chrome116'],
  platform: 'browser',
  sourcemap: WATCH ? 'inline' : false,
  minify: !WATCH,
  legalComments: 'none',
  logLevel: 'info'
};

const BUNDLES = [
  {
    name: 'service-worker',
    entryPoints: [path.join(ROOT, 'src/presentation/background/service-worker.ts')],
    outfile: path.join(OUT, 'service-worker.js'),
    format: 'esm'
  },
  {
    name: 'content',
    entryPoints: [path.join(ROOT, 'src/presentation/content/content-main.ts')],
    outfile: path.join(OUT, 'content.js'),
    format: 'iife'
  },
  {
    name: 'popup',
    entryPoints: [path.join(ROOT, 'src/presentation/popup/popup-main.ts')],
    outfile: path.join(OUT, 'popup/popup.js'),
    format: 'iife'
  }
];

async function copyStatic() {
  await cp(path.join(ROOT, 'manifest.json'), path.join(OUT, 'manifest.json'));
  await cp(path.join(ROOT, 'icons'), path.join(OUT, 'icons'), { recursive: true });
  await cp(
    path.join(ROOT, 'src/presentation/popup/popup.html'),
    path.join(OUT, 'popup/popup.html')
  );
  await cp(path.join(ROOT, 'src/presentation/popup/popup.css'), path.join(OUT, 'popup/popup.css'));
}

/**
 * O native messaging host roda fora do bundle (processo Node separado, lancado
 * pelo Chrome), entao nao pode importar o catalogo em TypeScript. Em vez de
 * manter uma segunda copia da tabela de motores la dentro — que foi exatamente
 * o problema que esta refatoracao ataca — o build exporta o catalogo para JSON
 * e o host le esse arquivo.
 */
async function emitEngineCatalog() {
  const tmp = path.join(OUT, '.catalog.mjs');
  await build({
    entryPoints: [path.join(ROOT, 'src/infrastructure/catalog/engines.catalog.ts')],
    outfile: tmp,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent'
  });

  const { LOCAL_SERVER_CATALOG } = await import(pathToFileURL(tmp).href + `?t=${Date.now()}`);
  await writeFile(
    path.join(ROOT, 'tools/native-host/engines.generated.json'),
    JSON.stringify(LOCAL_SERVER_CATALOG, null, 2) + '\n',
    'utf8'
  );
  await rm(tmp, { force: true });
}

async function run() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'popup'), { recursive: true });
  await copyStatic();
  await emitEngineCatalog();

  if (!WATCH) {
    await Promise.all(BUNDLES.map(({ name: _name, ...options }) => build({ ...shared, ...options })));
    console.log(`\nbuild pronto em ${path.relative(ROOT, OUT)}/`);
    console.log('Carregue essa pasta em chrome://extensions (Carregar sem compactacao).');
    return;
  }

  const contexts = await Promise.all(
    BUNDLES.map(({ name: _name, ...options }) => context({ ...shared, ...options }))
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('\nwatch ativo. Ctrl+C para sair.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

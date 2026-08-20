/* Leitura/escrita das preferencias em chrome.storage.local com defaults. */

import '../../shared/constants.js';

const { DEFAULTS } = globalThis.UDUB;
const KEY = 'settings';
const MIGRATIONS_KEY = 'migrations';

let cache = null;

/**
 * Ajustes ja gravados nao herdam mudancas de default. Cada migracao roda uma
 * vez so, entao uma escolha posterior do usuario continua valendo.
 */
async function migrate(settings, done) {
  const applied = Object.assign({}, done);
  let changed = false;

  // o painel flutuante na aula passou a ser opcional e nasce desligado
  if (!applied.overlayOff) {
    settings.showOverlay = false;
    applied.overlayOff = true;
    changed = true;
  }

  if (changed) {
    await chrome.storage.local.set({ [KEY]: settings, [MIGRATIONS_KEY]: applied });
  }
  return settings;
}

export async function getSettings() {
  if (cache) return cache;
  const stored = await chrome.storage.local.get([KEY, MIGRATIONS_KEY]);
  const settings = Object.assign({}, DEFAULTS, stored[KEY] || {});
  cache = await migrate(settings, stored[MIGRATIONS_KEY] || {});
  return cache;
}

export async function setSettings(patch) {
  const current = await getSettings();
  cache = Object.assign({}, current, patch || {});
  await chrome.storage.local.set({ [KEY]: cache });
  return cache;
}

/** Invalida o cache quando outra parte da extensao grava as preferencias. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[KEY]) cache = null;
});

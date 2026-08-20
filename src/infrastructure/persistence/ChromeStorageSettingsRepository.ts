/*
 * Preferencias em chrome.storage.local, com defaults e migracoes.
 *
 * As migracoes rodam uma unica vez cada e ficam registradas. Isso importa: sem
 * o registro, uma migracao que desliga uma opcao voltaria a desligar a cada
 * leitura e o usuario nunca conseguiria religar.
 */

import type { Settings, SettingsPatch } from '../../application/dto/Settings.ts';
import type { SettingsRepository } from '../../application/ports/repositories.ts';
import { DEFAULT_SETTINGS } from '../catalog/defaults.ts';

const SETTINGS_KEY = 'settings';
const MIGRATIONS_KEY = 'migrations';

type MigrationLog = Record<string, boolean>;

interface Migration {
  readonly id: string;
  readonly apply: (settings: Settings) => Settings;
}

const MIGRATIONS: readonly Migration[] = [
  {
    // o painel flutuante na aula passou a ser opcional e nasce desligado
    id: 'overlayOff',
    apply: (settings) => ({ ...settings, showOverlay: false })
  },
  {
    /*
     * As chaves de API deixaram de vir preenchidas no codigo. Quem ja usava a
     * extensao tem no storage a chave compartilhada antiga, que foi exposta
     * publicamente e precisa sair: continuar usando gastaria a conta de outra
     * pessoa e daria a falsa impressao de credencial propria.
     */
    id: 'dropSharedApiKeys',
    apply: (settings) => ({
      ...settings,
      deepgramApiKey: isSharedKey(settings.deepgramApiKey) ? '' : settings.deepgramApiKey,
      elevenApiKey: isSharedKey(settings.elevenApiKey) ? '' : settings.elevenApiKey,
      inworldApiKey: isSharedKey(settings.inworldApiKey) ? '' : settings.inworldApiKey
    })
  }
];

/**
 * Prefixos das credenciais que vinham embutidas no codigo-fonte. So o prefixo,
 * para nao reintroduzir a chave completa no repositorio ao remove-la.
 */
const SHARED_KEY_PREFIXES = ['ddd98968ba41', 'sk_e2de8bb37a00', 'Z1lHQmdfQnJn'] as const;

function isSharedKey(value: string): boolean {
  const key = String(value ?? '').trim();
  return SHARED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export class ChromeStorageSettingsRepository implements SettingsRepository {
  #cache: Settings | null = null;

  constructor() {
    // outra parte da extensao gravou: derruba o cache para reler
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) this.#cache = null;
    });
  }

  async load(): Promise<Settings> {
    if (this.#cache) return this.#cache;

    const stored = await chrome.storage.local.get([SETTINGS_KEY, MIGRATIONS_KEY]);
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      ...((stored[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {})
    };

    this.#cache = await this.#migrate(
      settings,
      (stored[MIGRATIONS_KEY] as MigrationLog | undefined) ?? {}
    );
    return this.#cache;
  }

  async save(patch: SettingsPatch): Promise<Settings> {
    const current = await this.load();
    const next: Settings = { ...current, ...patch };
    this.#cache = next;
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }

  async #migrate(settings: Settings, applied: MigrationLog): Promise<Settings> {
    const pending = MIGRATIONS.filter((migration) => !applied[migration.id]);
    if (pending.length === 0) return settings;

    const migrated = pending.reduce((current, migration) => migration.apply(current), settings);
    const log: MigrationLog = { ...applied };
    for (const migration of pending) log[migration.id] = true;

    await chrome.storage.local.set({ [SETTINGS_KEY]: migrated, [MIGRATIONS_KEY]: log });
    return migrated;
  }
}

/*
 * Service worker: ponto de entrada do lado de fundo da extensao.
 *
 * Cada mensagem e um Command registrado no barramento. Os handlers sao finos de
 * proposito: traduzem a mensagem para uma chamada de caso de uso e devolvem o
 * resultado. A versao anterior tinha um objeto de handlers de 190 linhas que
 * tambem orquestrava jobs, controlava a fila de adiantamento e falava com o
 * native host.
 */

import { JobStatus } from '../../domain/entities/JobStatus.ts';
import type { Lecture } from '../../domain/entities/Lecture.ts';
import type { DubManifest } from '../../application/dto/DubManifest.ts';
import type { JobProgress } from '../../application/dto/JobProgress.ts';
import { selectEngines } from '../../application/services/ResolveEngineSelection.ts';
import {
  ENGINE_CAPABILITIES,
  LOCAL_SETTING_KEYS
} from '../../infrastructure/catalog/engines.catalog.ts';
import type { Settings } from '../../application/dto/Settings.ts';
import type { LocalTtsEngineId } from '../../domain/value-objects/EngineId.ts';
import { MSG } from '../../infrastructure/messaging/contracts.ts';
import { unwrap } from '../../infrastructure/messaging/MessageBus.ts';
import {
  buildDubbingUseCases,
  bus,
  clearCache,
  clock,
  deleteDub,
  findDub,
  getClips,
  getManifest,
  jobs,
  lectureSourceFor,
  listDubs,
  loadSettings,
  logger,
  nativeHost,
  saveSettings,
  enforceCacheLimit
} from './container.ts';
import { testCredential } from './CredentialTester.ts';

/** Ultima aula reportada por aba, para o popup nao ter de esperar a leitura. */
const tabLectures = new Map<number, Lecture>();

// ------------------------------------------------------------- publicacao

function publishProgress(tabId: number, progress: JobProgress): void {
  jobs.recordProgress(tabId, progress);
  void bus.send(MSG.JOB_PROGRESS, { tabId, progress });
  void bus.sendToTab(tabId, MSG.JOB_PROGRESS, { tabId, progress });
}

function publishManifest(tabId: number, manifest: DubManifest, autoEnable: boolean): void {
  void bus.sendToTab(tabId, MSG.DUB_READY, {
    manifest,
    lectureId: manifest.lectureId,
    autoEnable
  });
}

// ------------------------------------------------------------------ helpers

function resolveTabId(
  explicit: number | null,
  sender: chrome.runtime.MessageSender
): number | null {
  return explicit ?? sender.tab?.id ?? null;
}

/** Contexto da aula: primeiro o que a aba reportou, senao pede para ela ler. */
async function lectureFor(tabId: number): Promise<Lecture | null> {
  const cached = tabLectures.get(tabId);
  if (cached) return cached;

  const lecture = await lectureSourceFor(tabId).getLectureContext();
  if (lecture) tabLectures.set(tabId, lecture);
  return lecture;
}

function localCommandFor(engine: LocalTtsEngineId, settings: Settings) {
  const keys = LOCAL_SETTING_KEYS[engine];
  const url = String(settings[keys.url as keyof Settings]);

  let port = 0;
  try {
    port = Number(new URL(url).port) || 0;
  } catch {
    /* URL invalida: o adapter cai para a porta padrao do catalogo */
  }

  return {
    engine,
    port,
    voice: String(settings[keys.voice as keyof Settings]),
    cuda: Boolean(settings[keys.cuda as keyof Settings])
  };
}

// -------------------------------------------------------------- os comandos

bus
  .on(MSG.GET_STATE, async ({ tabId }) => {
    const settings = await loadSettings();
    const tabState = tabId ? unwrap(await bus.sendToTab(tabId, MSG.GET_TAB_STATE, {})) : null;

    if (tabState?.lecture && tabId) tabLectures.set(tabId, tabState.lecture);
    const lecture = tabState?.lecture ?? (tabId ? await lectureFor(tabId) : null);

    return {
      settings,
      engines: selectEngines(settings, ENGINE_CAPABILITIES),
      lecture,
      manifest: lecture ? await findDub.execute(lecture.lectureId, settings) : null,
      enabled: Boolean(tabState?.enabled),
      running: tabId !== null && jobs.isRunning(tabId),
      progress: (tabId !== null ? jobs.lastProgress(tabId) : null) ?? tabState?.progress ?? null
    };
  })

  .on(MSG.CONTENT_READY, async ({ lecture }, sender) => {
    const tabId = sender.tab?.id ?? null;
    if (tabId) tabLectures.set(tabId, lecture);

    const settings = await loadSettings();
    return {
      settings,
      manifest: lecture.lectureId ? await findDub.execute(lecture.lectureId, settings) : null,
      progress: tabId !== null && jobs.isRunning(tabId) ? jobs.lastProgress(tabId) : null
    };
  })

  .on(MSG.START_JOB, async ({ tabId, startAt, force }, sender) => {
    const target = resolveTabId(tabId, sender);
    if (target === null) throw new Error('Nao consegui identificar a aba.');

    const lecture = await lectureFor(target);
    if (!lecture?.lectureId) {
      throw new Error('Abra uma aula da Udemy (pagina do player) antes de dublar.');
    }

    const settings = await loadSettings();
    const runJob = buildDubbingUseCases(lectureSourceFor(target), {
      publishProgress,
      publishManifest
    });

    await runJob.start({
      tabId: target,
      lecture,
      settings,
      startAt: Number(startAt) || lecture.currentTime || 0,
      force: Boolean(force),
      manual: true
    });

    return {};
  })

  .on(MSG.CANCEL_JOB, ({ tabId }, sender) => {
    const target = resolveTabId(tabId, sender);
    return { canceled: target !== null && jobs.cancel(target) };
  })

  .on(MSG.SET_SETTINGS, async ({ patch }) => {
    const settings = await saveSettings(patch);

    // as abas precisam saber na hora: volume e overlay mudam sem recarregar
    const tabs = await chrome.tabs.query({ url: ['https://*.udemy.com/course/*'] });
    for (const tab of tabs) void bus.sendToTab(tab.id, MSG.APPLY_SETTINGS, { settings });

    return { settings, engines: selectEngines(settings, ENGINE_CAPABILITIES) };
  })

  .on(MSG.SET_ENABLED, async ({ tabId, enabled }, sender) => {
    await bus.sendToTab(resolveTabId(tabId, sender), MSG.APPLY_ENABLED, { enabled });
    return {};
  })

  .on(MSG.LIST_DUBS, () => listDubs.execute())

  .on(MSG.DELETE_DUB, async ({ key }) => {
    await deleteDub.execute(key);
    return {};
  })

  .on(MSG.CLEAR_CACHE, async () => {
    await clearCache.execute();
    return {};
  })

  .on(MSG.GET_MANIFEST, async ({ key, lectureId }) => {
    const settings = await loadSettings();
    const manifest = key
      ? await getManifest.execute(key)
      : lectureId
        ? await findDub.execute(lectureId, settings)
        : null;
    return { manifest, settings };
  })

  .on(MSG.GET_CLIPS, async ({ key, from, count }) => ({
    clips: await getClips.execute(key, from, count)
  }))

  .on(MSG.PING, ({ tabId }, sender) => {
    // mantem o worker vivo durante o job e avisa se ele foi reciclado
    const target = resolveTabId(tabId, sender);
    return { running: target !== null && jobs.isRunning(target) };
  })

  .on(MSG.TEST_CREDENTIAL, async (input) => ({
    result: await testCredential(input, await loadSettings())
  }))

  .on(MSG.LOCAL_STATUS, async ({ engine }) => {
    const settings = await loadSettings();
    return { status: await nativeHost.status(localCommandFor(engine, settings)) };
  })

  .on(MSG.LOCAL_START, async ({ engine }) => {
    const settings = await loadSettings();
    return { status: await nativeHost.start(localCommandFor(engine, settings)) };
  })

  .on(MSG.LOCAL_STOP, async ({ engine }) => {
    const settings = await loadSettings();
    return { status: await nativeHost.stop(localCommandFor(engine, settings)) };
  });

bus.listen();

// ------------------------------------------------------------- ciclo de vida

chrome.tabs.onRemoved.addListener((tabId) => {
  jobs.forget(tabId);
  tabLectures.delete(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const settings = await loadSettings();
    await enforceCacheLimit.execute(settings.cacheMaxDubs);
    logger.info(
      `pronto (status inicial: ${JobStatus.IDLE}) em ${new Date(clock.now()).toISOString()}`
    );
  })();
});

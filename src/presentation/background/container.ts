/*
 * Composition root do service worker.
 *
 * E o unico lugar do projeto onde as camadas se encontram: aqui as portas
 * declaradas em application recebem os adapters de infrastructure. Nenhum caso
 * de uso sabe que existe Deepgram, IndexedDB ou chrome.storage; eles recebem
 * interfaces montadas aqui.
 *
 * As dependencias que variam com as preferencias (URL do servidor, credencial,
 * modelo) sao passadas como FUNCOES e nao como valores. Assim trocar a voz ou a
 * porta no popup vale na proxima chamada, sem reconstruir o container nem
 * recarregar a extensao.
 */

import type { Settings } from '../../application/dto/Settings.ts';
import type { SpeechSynthesisPort } from '../../application/ports/SpeechSynthesisPort.ts';
import type { LectureSourcePort } from '../../application/ports/LectureSourcePort.ts';
import { SYSTEM_CLOCK } from '../../application/ports/Clock.ts';
import { TtsRegistry } from '../../application/services/TtsRegistry.ts';
import { JobManager } from '../../application/services/JobManager.ts';
import { BuildTranscript } from '../../application/usecases/BuildTranscript.ts';
import { TranslateSegments } from '../../application/usecases/TranslateSegments.ts';
import { SynthesizeSegments } from '../../application/usecases/SynthesizeSegments.ts';
import { DubLecture } from '../../application/usecases/DubLecture.ts';
import { PrefetchNextLectures } from '../../application/usecases/PrefetchNextLectures.ts';
import { EnforceCacheLimit } from '../../application/usecases/EnforceCacheLimit.ts';
import { FindDubForLecture, GetDubManifest } from '../../application/usecases/FindDubForLecture.ts';
import {
  ClearCache,
  DeleteDub,
  GetClips,
  ListDubs
} from '../../application/usecases/ManageCache.ts';
import { RunDubJob, type RunDubJobDeps } from '../../application/usecases/RunDubJob.ts';
import {
  ENGINE_CAPABILITIES,
  LOCAL_SERVER_CATALOG,
  describeEngine
} from '../../infrastructure/catalog/engines.catalog.ts';
import { ConsoleLogger } from '../../infrastructure/logging/ConsoleLogger.ts';
import {
  IndexedDbCacheMaintenance,
  IndexedDbClipRepository,
  IndexedDbDubRepository,
  IndexedDbTranscriptRepository,
  IndexedDbTranslationRepository
} from '../../infrastructure/persistence/IndexedDbRepositories.ts';
import { ChromeStorageSettingsRepository } from '../../infrastructure/persistence/ChromeStorageSettingsRepository.ts';
import { GoogleTranslateAdapter } from '../../infrastructure/translation/GoogleTranslateAdapter.ts';
import { DeepgramSttAdapter } from '../../infrastructure/stt/DeepgramSttAdapter.ts';
import { CaptionsSttAdapter } from '../../infrastructure/stt/CaptionsSttAdapter.ts';
import { DeepgramTtsAdapter } from '../../infrastructure/tts/DeepgramTtsAdapter.ts';
import { ElevenLabsTtsAdapter } from '../../infrastructure/tts/ElevenLabsTtsAdapter.ts';
import { InworldTtsAdapter } from '../../infrastructure/tts/InworldTtsAdapter.ts';
import { GoogleTtsAdapter } from '../../infrastructure/tts/GoogleTtsAdapter.ts';
import { LocalHttpTtsAdapter } from '../../infrastructure/tts/LocalHttpTtsAdapter.ts';
import { NativeHostAdapter } from '../../infrastructure/native/NativeHostAdapter.ts';
import { MessageBus } from '../../infrastructure/messaging/MessageBus.ts';
import { TabLectureSource } from './TabLectureSource.ts';

export const logger = new ConsoleLogger('worker');
export const bus = new MessageBus(logger);
export const clock = SYSTEM_CLOCK;

export const settingsRepository = new ChromeStorageSettingsRepository();
export const dubs = new IndexedDbDubRepository();
export const clips = new IndexedDbClipRepository();
export const transcripts = new IndexedDbTranscriptRepository();
export const translations = new IndexedDbTranslationRepository();
export const maintenance = new IndexedDbCacheMaintenance();
export const nativeHost = new NativeHostAdapter();

export const jobs = new JobManager();

/**
 * Leitura das preferencias sem await no ponto de uso.
 *
 * Os adapters precisam da credencial e da URL no meio de uma sintese, onde uma
 * leitura assincrona por trecho seria desperdicio. O repositorio ja tem cache
 * em memoria; este espelho existe para o acesso sincrono.
 */
let currentSettings: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  currentSettings = await settingsRepository.load();
  return currentSettings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  currentSettings = await settingsRepository.save(patch);
  return currentSettings;
}

function setting<K extends keyof Settings>(key: K): () => Settings[K] {
  return () => {
    if (!currentSettings) throw new Error('preferencias ainda nao carregadas');
    return currentSettings[key];
  };
}

// ------------------------------------------------------------ motores de voz

export const localAdapters = {
  piper: new LocalHttpTtsAdapter({
    engine: 'piper',
    label: LOCAL_SERVER_CATALOG.piper.label,
    concurrency: describeEngine('piper').concurrency,
    baseUrl: setting('piperUrl'),
    lengthScale: setting('piperLengthScale'),
    setupHint: LOCAL_SERVER_CATALOG.piper.setupHint
  }),
  kokoro: new LocalHttpTtsAdapter({
    engine: 'kokoro',
    label: LOCAL_SERVER_CATALOG.kokoro.label,
    concurrency: describeEngine('kokoro').concurrency,
    baseUrl: setting('kokoroUrl'),
    setupHint: LOCAL_SERVER_CATALOG.kokoro.setupHint
  }),
  f5: new LocalHttpTtsAdapter({
    engine: 'f5',
    label: LOCAL_SERVER_CATALOG.f5.label,
    concurrency: describeEngine('f5').concurrency,
    baseUrl: setting('f5Url'),
    setupHint: LOCAL_SERVER_CATALOG.f5.setupHint
  })
} as const;

export const deepgramTts = new DeepgramTtsAdapter(
  setting('deepgramApiKey'),
  describeEngine('deepgram').concurrency
);

export const elevenLabsTts = new ElevenLabsTtsAdapter({
  apiKey: setting('elevenApiKey'),
  model: setting('elevenModel'),
  format: setting('elevenFormat'),
  concurrency: describeEngine('elevenlabs').concurrency
});

export const inworldTts = new InworldTtsAdapter({
  apiKey: setting('inworldApiKey'),
  model: setting('inworldModel'),
  bitRate: setting('inworldBitRate'),
  concurrency: describeEngine('inworld').concurrency
});

export const googleTts = new GoogleTtsAdapter();

const synthesizers: SpeechSynthesisPort[] = [
  localAdapters.piper,
  localAdapters.kokoro,
  localAdapters.f5,
  deepgramTts,
  elevenLabsTts,
  inworldTts,
  googleTts
];

export const registry = new TtsRegistry(synthesizers);

// ---------------------------------------------------------------- casos de uso

export const translator = new GoogleTranslateAdapter();
export const deepgramStt = new DeepgramSttAdapter({
  apiKey: setting('deepgramApiKey'),
  model: setting('deepgramSttModel')
});

export const enforceCacheLimit = new EnforceCacheLimit({ dubs, logger });
export const findDub = new FindDubForLecture({ dubs, capabilities: ENGINE_CAPABILITIES });
export const getManifest = new GetDubManifest(dubs);
export const listDubs = new ListDubs(dubs, maintenance);
export const deleteDub = new DeleteDub(dubs);
export const clearCache = new ClearCache(maintenance);
export const getClips = new GetClips(clips);

/**
 * Os casos de uso de dublagem dependem da aba: a leitura da pagina passa por
 * ela. Por isso sao montados por aba, e nao uma vez so no modulo.
 */
export function buildDubbingUseCases(
  source: LectureSourcePort,
  publish: Pick<RunDubJobDeps, 'publishProgress' | 'publishManifest'>
): RunDubJob {
  const buildTranscript = new BuildTranscript({
    // ordem da cadeia: a fonte escolhida primeiro, as gratuitas depois
    sources: [deepgramStt, new CaptionsSttAdapter(source)],
    transcripts,
    clock
  });

  const translateSegments = new TranslateSegments({
    translator,
    cache: translations
  });

  const synthesizeSegments = new SynthesizeSegments({
    registry,
    clips,
    dubs,
    logger,
    clock
  });

  const dubLecture = new DubLecture({
    buildTranscript,
    translateSegments,
    synthesizeSegments,
    enforceCacheLimit,
    registry,
    dubs,
    clips,
    capabilities: ENGINE_CAPABILITIES,
    clock
  });

  const prefetch = new PrefetchNextLectures({
    source,
    dubLecture,
    findDub,
    capabilities: ENGINE_CAPABILITIES,
    logger
  });

  return new RunDubJob({
    jobs,
    dubLecture,
    prefetch,
    getManifest,
    logger,
    clock,
    ...publish
  });
}

export function lectureSourceFor(tabId: number): LectureSourcePort {
  return new TabLectureSource(bus, tabId);
}

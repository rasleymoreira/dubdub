import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { JobManager, JobAlreadyRunningError } from '../../src/application/services/JobManager.ts';

const TAB = 1;

describe('JobManager', () => {
  it('aba livre aceita qualquer job', async () => {
    const jobs = new JobManager();
    await assert.doesNotReject(jobs.claim(TAB, true));
    await assert.doesNotReject(jobs.claim(TAB, false));
  });

  it('recusa um segundo job manual sobre um job manual', async () => {
    const jobs = new JobManager();
    jobs.register(TAB, '100', 0);
    await assert.rejects(jobs.claim(TAB, true), JobAlreadyRunningError);
  });

  it('recusa job automatico enquanto o adiantamento roda', async () => {
    const jobs = new JobManager();
    const handle = jobs.register(TAB, '100', 0);
    handle.prefetching = true;
    await assert.rejects(jobs.claim(TAB, false), JobAlreadyRunningError);
  });

  it('Dublar manual interrompe a fila de adiantamento e assume a aba', async () => {
    const jobs = new JobManager();
    const handle = jobs.register(TAB, '100', 0);
    handle.prefetching = true;

    let parou = false;
    handle.promise = (async () => {
      while (!handle.token.canceled) await new Promise((resolve) => setImmediate(resolve));
      parou = true;
    })();

    await jobs.claim(TAB, true);

    assert.ok(handle.token.canceled, 'o token do prefetch deveria ter sido cancelado');
    assert.ok(parou, 'claim deveria esperar o job anterior encerrar antes de liberar a aba');
  });

  it('claim nao vaza erro do job anterior', async () => {
    const jobs = new JobManager();
    const handle = jobs.register(TAB, '100', 0);
    handle.prefetching = true;
    handle.promise = Promise.reject(new Error('job anterior explodiu'));

    await assert.doesNotReject(jobs.claim(TAB, true));
  });

  it('cancel devolve false quando nao ha job na aba', () => {
    assert.equal(new JobManager().cancel(TAB), false);
  });

  it('guarda o ultimo progresso para o popup reabrir e ver o estado', () => {
    const jobs = new JobManager();
    jobs.recordProgress(TAB, { status: 'synthesizing', done: 3, total: 10 });
    assert.equal(jobs.lastProgress(TAB)?.done, 3);
    assert.equal(jobs.lastProgress(999), null);
  });

  it('fechar a aba cancela o job e esquece o estado', () => {
    const jobs = new JobManager();
    const handle = jobs.register(TAB, '100', 0);
    jobs.recordProgress(TAB, { status: 'synthesizing' });

    jobs.forget(TAB);

    assert.ok(handle.token.canceled);
    assert.equal(jobs.isRunning(TAB), false);
    assert.equal(jobs.lastProgress(TAB), null);
  });
});

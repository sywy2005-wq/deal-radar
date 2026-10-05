import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CollectionJournal, INTERVAL_MS, DEADLINE_MS } from '../src/collection-journal.js';
const source = { id: 'test', enabled: true };
const start = 1800000000000;
const success = { ok: true, quote: { comparable: true, observedAt: new Date(start).toISOString() } };
const failure = { ok: false };
function memory(t) { const journal = new CollectionJournal(':memory:'); t.after(() => journal.close()); return journal; }

test('同一计划幂等且关闭来源不产生任务', t => {
  const journal = memory(t);
  journal.plan([source, { id: 'off', enabled: false }], start);
  journal.plan([source], start);
  const job = journal.claim(start, ['test', 'off']);
  assert.equal(job.source_id, 'test');
  assert.equal(journal.claim(start, ['test', 'off']), null);
  journal.finish(job, success, start + 1000);
  assert.equal(journal.claim(start, ['test']), null);
});
test('一三十分钟重试，超过三次重试终止', t => {
  const journal = memory(t);
  journal.plan([source], start);
  let job = journal.claim(start, ['test']);
  journal.finish(job, failure, start);
  assert.equal(journal.claim(start + 59999, ['test']), null);
  job = journal.claim(start + 60000, ['test']);
  assert.equal(job.attempts, 2);
  journal.finish(job, failure, start + 60000);
  assert.equal(journal.claim(start + 239999, ['test']), null);
  job = journal.claim(start + 240000, ['test']);
  assert.equal(job.attempts, 3);
  journal.finish(job, failure, start + 240000);
  assert.equal(journal.claim(start + 839999, ['test']), null);
  job = journal.claim(start + 840000, ['test']);
  assert.equal(job.attempts, 4);
  journal.finish(job, failure, start + 840000);
  assert.equal(journal.claim(start + 1000000, ['test']), null);
  assert.equal(journal.status(start + 1000000, [source]).sources[0].consecutiveFailureAlert, true);
});
test('租约过期可以恢复，旧执行者不能覆盖新结果', t => {
  const journal = memory(t);
  journal.plan([source], start);
  const old = journal.claim(start, ['test']);
  const recovered = journal.claim(start + 60000, ['test']);
  assert.equal(recovered.id, old.id);
  assert.equal(recovered.attempts, 2);
  assert.equal(journal.finish(old, success, start + 60001), false);
  assert.equal(journal.finish(recovered, success, start + 60002), true);
});
test('关闭自动调度时手动领取不执行遗留计划任务', t => {
  const journal = memory(t);
  journal.plan([source], start);
  assert.equal(journal.claim(start, ['test'], { manualOnly: true }), null);
  journal.addManual([source], start);
  assert.equal(journal.claim(start, ['test'], { manualOnly: true }).kind, 'manual');
});
test('已过截止时间的任务标为错过，不抓取旧价格', t => {
  const journal = memory(t);
  journal.plan([source], start);
  journal.plan([source], start + DEADLINE_MS + 1);
  const job = journal.claim(start + DEADLINE_MS + 1, ['test']);
  assert.notEqual(job.scheduled_at, start);
  const state = journal.status(start + DEADLINE_MS + 1, [source]);
  assert.equal(state.maturedJobs, 1);
  assert.equal(state.timelyUsableJobs, 0);
});
test('重启保留计划和成功记录，手动与条件不完整记录不算及时成功', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'deal-radar-jobs-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'jobs.sqlite');
  const first = new CollectionJournal(file);
  first.plan([source], start);
  first.close();
  const journal = new CollectionJournal(file);
  t.after(() => journal.close());
  journal.finish(journal.claim(start, ['test']), { ok: true, quote: { ...success.quote, comparable: false } }, start + 1000);
  journal.addManual([source], start);
  journal.finish(journal.claim(start, ['test']), success, start + 1001);
  const state = journal.status(start + DEADLINE_MS, [source]);
  assert.equal(state.maturedJobs, 1);
  assert.equal(state.timelyUsableJobs, 0);
  assert.equal(state.sevenDayAccepted, false);
});
test('完整七日窗口达标需要每个启用来源都有足够计划样本', t => {
  const journal = memory(t);
  for (let index = 0; index < 1008; index++) {
    const now = start + index * INTERVAL_MS;
    journal.plan([source], now);
    journal.finish(journal.claim(now, ['test']), success, now + 1000);
  }
  const now = start + 1007 * INTERVAL_MS + DEADLINE_MS;
  const state = journal.status(now, [source]);
  assert.equal(state.maturedJobs, 1008);
  assert.equal(state.timelySuccessRate, 1);
  assert.equal(state.sevenDayAccepted, true);
  assert.equal(journal.status(now, [source, { id: 'new', enabled: true }]).sevenDayAccepted, false);
  assert.equal(journal.status(now, [{ ...source, enabled: false }]).sevenDayAccepted, false);
});

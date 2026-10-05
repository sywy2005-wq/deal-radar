import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QuoteStore } from '../src/store.js';

const row = {
  sourceId: 'x', sourceName: 'Test source', sku: 'KX0493', size: 'L',
  currency: 'CNY', price: 1, priceCents: 100,
  observedAt: '2026-10-02T00:00:00Z', verifiedAt: '2026-10-02T00:01:00Z'
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'deal-radar-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, 'history.json') };
}

test('原子持久化并对并发重复采集去重', async t => {
  const { file } = await fixture(t);
  const store = new QuoteStore(file);
  await Promise.all([store.add(row), store.add(row)]);
  assert.deepEqual(await store.list(), [row]);
  assert.match(await readFile(file, 'utf8'), /KX0493/);
});
test('拒绝保存未校验或验证时间无效的数据', async () => {
  const store = new QuoteStore('/unused');
  await assert.rejects(store.add({ price: 1 }), /只允许/);
  await assert.rejects(store.add({ ...row, verifiedAt: 'invalid' }), /只允许/);
});
test('一次写入失败保留旧记录，后续写入恢复并清理临时文件', async t => {
  const { file, directory } = await fixture(t);
  let failOnce = false;
  const store = new QuoteStore(file, { io: { writeFile: async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('test EIO'); }
    return writeFile(...args);
  } } });
  await store.add(row);
  const next = { ...row, observedAt: '2026-10-02T00:02:00Z' };
  failOnce = true;
  await assert.rejects(store.add(next), /test EIO/);
  assert.deepEqual(await store.list(), [row]);
  await store.add(next);
  assert.deepEqual(await store.list(), [row, next]);
  assert.deepEqual(await readdir(directory), ['history.json']);
});
test('前一个写入失败不会导致已经排队的写入失败', async t => {
  const { file } = await fixture(t);
  let failOnce = true;
  const store = new QuoteStore(file, { io: { writeFile: async (...args) => {
    if (failOnce) { failOnce = false; throw new Error('test EIO'); }
    return writeFile(...args);
  } } });
  const first = store.add(row);
  const second = store.add({ ...row, observedAt: '2026-10-02T00:02:00Z' });
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal((await store.list()).length, 1);
});
test('不同颜色和优惠适用人群不会被错误去重', async t => {
  const { file } = await fixture(t);
  const store = new QuoteStore(file);
  const a = { ...row, color: 'black', eligibilityKey: 'public' };
  const b = { ...row, color: 'blue', eligibilityKey: 'public' };
  const c = { ...row, color: 'black', eligibilityKey: 'member-a' };
  await Promise.all([store.add(a), store.add(b), store.add(c)]);
  assert.equal((await store.list()).length, 3);
});

test('同价同时刻的优惠证据或有效期变化不能被错误去重', async t => {
  const { file } = await fixture(t);
  const store = new QuoteStore(file);
  const first = { ...row, evidence: { responseSha256: 'test-a', parserVersion: 'json-v3' },
    pricing: { status: 'calculated', validUntil: '2026-10-03T00:00:00Z', applied: [{ id: 'coupon-a' }] } };
  const changed = { ...first, evidence: { ...first.evidence, responseSha256: 'test-b' } };
  const newPlan = { ...changed, pricing: { ...first.pricing, applied: [{ id: 'coupon-b' }] } };
  await store.add(first);
  await store.add(changed);
  await store.add(newPlan);
  await store.add(newPlan);
  assert.equal((await store.list()).length, 3);
});

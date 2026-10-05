import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectionJournal } from '../src/collection-journal.js';
import { Collector } from '../src/collector.js';
const source = { id: 'test', name: 'Test source', enabled: true, url: 'https://shop.example/api', maxAgeMinutes: 15 };
const raw = () => ({ sku: 'KX0493', size: 'L', currency: 'CNY', price: 100,
  productUrl: 'https://shop.example/item', observedAt: new Date().toISOString() });
function fixture(t, overrides = {}) {
  const journal = new CollectionJournal(':memory:');
  const collector = new Collector({ sources: [source], quoteStore: { add: async () => {} },
    journal, ...overrides });
  t.after(async () => { await collector.stop(); journal.close(); });
  return collector;
}
test('并发手动刷新合并为一次实际请求', async t => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const collector = fixture(t, { fetchImpl: async () => { calls++; await gate; return { ok: true, json: async () => raw() }; } });
  const first = collector.run({ manual: true });
  const second = collector.run({ manual: true });
  assert.equal(first, second);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.results[0].ok, true);
  assert.equal(b.results[0].quote.evidence.parserVersion, 'json-v3');
});
test('未启用来源不会发请求，默认不启动定时器', async t => {
  let calls = 0;
  const collector = fixture(t, { sources: [{ ...source, enabled: false }],
    fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  collector.start();
  assert.equal(collector.status().running, false);
  assert.deepEqual((await collector.run({ manual: true })).results, []);
  assert.equal(calls, 0);
});
test('持久化失败记为失败并进入重试，而不报告采集成功', async t => {
  const collector = fixture(t, { enabled: true,
    quoteStore: { add: async () => { throw new Error('test EIO'); } },
    fetchImpl: async () => ({ ok: true, json: async () => raw() }) });
  const result = await collector.run();
  assert.equal(result.results[0].ok, false);
  assert.equal(collector.status().sources[0].lastResult, 'error');
});

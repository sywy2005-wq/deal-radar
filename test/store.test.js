import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QuoteStore } from '../src/store.js';

test('原子持久化已验证报价并去重', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'deal-radar-')), 'history.json');
  const store = new QuoteStore(file);
  const row = { sourceId: 'x', sku: 'KX0493', size: 'L', observedAt: '2026-10-02T00:00:00Z', verifiedAt: '2026-10-02T00:01:00Z' };
  await Promise.all([store.add(row), store.add(row)]);
  assert.deepEqual(await store.list(), [row]);
  assert.match(await readFile(file, 'utf8'), /KX0493/);
});

test('拒绝保存未验证数据', async () => {
  const store = new QuoteStore('/unused');
  await assert.rejects(store.add({ price: 1 }), /只允许/);
});

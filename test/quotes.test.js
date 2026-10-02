import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchVerifiedQuote, validateQuote } from '../src/quotes.js';

const source = { id: 'shop', name: 'Shop', url: 'https://shop.example/api/quote', enabled: true, maxAgeMinutes: 30 };
const now = new Date('2026-10-02T12:00:00Z');
const quote = { sku: 'KX0493', size: 'L', currency: 'CNY', price: 699, observedAt: '2026-10-02T11:50:00Z', productUrl: 'https://shop.example/products/KX0493' };

test('校验目标身份、时效、币种和来源域名', () => {
  const result = validateQuote(quote, source, now);
  assert.equal(result.ok, true);
  assert.equal(result.quote.price, 699);
  assert.ok(result.quote.verifiedAt);
});

test('拒绝不匹配或过期的报价', () => {
  const result = validateQuote({ ...quote, size: 'M', observedAt: '2026-10-02T10:00:00Z', productUrl: 'https://fake.example/a' }, source, now);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['尺码不匹配', '报价时间已过期或来自未来', '商品链接不属于数据源']);
});

test('默认关闭的数据源不会发起网络请求', async () => {
  let fetched = false;
  const result = await fetchVerifiedQuote({ ...source, enabled: false }, { fetchImpl: async () => { fetched = true; } });
  assert.equal(result.status, 'disabled'); assert.equal(fetched, false);
});

test('拉取后才把上游响应标记为已校验', async () => {
  const result = await fetchVerifiedQuote(source, { now, fetchImpl: async () => ({ ok: true, json: async () => quote }) });
  assert.equal(result.ok, true); assert.equal(result.status, 'checked');
});

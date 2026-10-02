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

test('条件缺失的报价保留待核验状态，不能宣称实际到手价', () => {
  const result = validateQuote(quote, source, now);
  assert.equal(result.ok, true);
  assert.equal(result.quote.verificationLevel, 'field_checked');
  assert.equal(result.quote.priceStatus, 'needs_verification');
  assert.equal(result.quote.comparable, false);
  assert.equal(result.quote.totalCents, null);
  assert.ok(result.quote.needsVerification.includes('库存待核验'));
  assert.ok(result.quote.needsVerification.includes('运费待核验'));
});
test('购买条件完整时计算来源条件合计，仍不等同于结账核验', () => {
  const result = validateQuote({
    ...quote, color: 'black', stock: 'in_stock', shipping: '10.01',
    shippingRegion: 'CN-31', quantity: 1, offerEligibility: 'public',
    eligibilityKey: 'public', couponCoverage: 'complete', priceBasis: 'payable_item_price'
  }, source, now);
  assert.equal(result.ok, true);
  assert.equal(result.quote.totalCents, 70901);
  assert.equal(result.quote.comparable, true);
  assert.equal(result.quote.verificationLevel, 'field_checked');
});
test('缺货或优惠信息不完整不参与比较', () => {
  const full = { ...quote, color: 'black', stock: 'in_stock', shipping: 0,
    shippingRegion: 'CN-31', quantity: 1, offerEligibility: 'public',
    eligibilityKey: 'public', couponCoverage: 'complete', priceBasis: 'payable_item_price' };
  for (const update of [{ stock: 'out_of_stock' }, { offerEligibility: 'unknown' },
    { couponCoverage: 'partial' }, { eligibilityKey: '' }, { priceBasis: 'item_price' }, { quantity: 2 }]) {
    const result = validateQuote({ ...full, ...update }, source, now);
    assert.equal(result.ok, true);
    assert.equal(result.quote.comparable, false);
    assert.equal(result.quote.totalCents, null);
  }
});
test('拒绝不足一分、布尔值、超范围价格和非法运费', () => {
  for (const price of [0.001, true, 1e20, 0, -1, '']) {
    assert.equal(validateQuote({ ...quote, price }, source, now).ok, false);
  }
  for (const shipping of [-1, true, '0.001']) {
    assert.equal(validateQuote({ ...quote, shipping }, source, now).ok, false);
  }
});
test('非法商品链接和时间配置返回校验失败而非未捕获异常', () => {
  for (const productUrl of ['http://[', 'javascript:alert(1)', 'https://user:password@shop.example/a']) {
    assert.equal(validateQuote({ ...quote, productUrl }, source, now).ok, false);
  }
  assert.equal(validateQuote(quote, { ...source, maxAgeMinutes: Infinity }, now).ok, false);
  assert.equal(validateQuote({ ...quote, observedAt: '2026-10-02T12:01:00Z' }, source, now).ok, false);
});

test('没有时区的观测时间不能作为真实采集时间', () => {
  assert.equal(validateQuote({ ...quote, observedAt: '2026-10-02T11:50:00' }, source, now).ok, false);
});

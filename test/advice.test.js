import test from 'node:test';
import assert from 'node:assert/strict';
import { buyingAdvice } from '../src/advice.js';
const NOW = Date.parse('2026-10-05T12:00:00Z');
const quote = (age, cents, extra = {}) => ({
  sourceId: 'test', sourceName: 'Test source', sku: 'KX0493', size: 'L', currency: 'CNY',
  price: cents / 100, priceCents: cents, shippingCents: 0, stock: 'in_stock',
  color: 'blue', shippingRegion: 'CN-31', quantity: 1,
  offerEligibility: 'public', eligibilityKey: 'public',
  couponCoverage: 'complete', priceBasis: 'payable_item_price',
  productUrl: 'https://shop.example/item',
  observedAt: new Date(NOW - age).toISOString(), verifiedAt: new Date(NOW - age).toISOString(), ...extra
});
test('没有记录不生成价格、购买时机或领取方案', () => {
  assert.deepEqual(buyingAdvice([], { now: NOW }).candidates, []);
  assert.equal(buyingAdvice([], { now: NOW }).status, 'waiting_for_data');
});
test('样本不足或跨度不足时不能判断购买时机', () => {
  assert.equal(buyingAdvice([quote(60000, 10000)], { now: NOW }).candidates[0].status, 'insufficient_history');
  const rows = [quote(180000, 11000), quote(120000, 10500), quote(60000, 10000)];
  assert.equal(buyingAdvice(rows, { now: NOW }).candidates[0].status, 'insufficient_history');
});
test('同条件多日观察低点仍要求结账核验', () => {
  const rows = [quote(172800000, 12000), quote(86400000, 11000), quote(60000, 10000)];
  const result = buyingAdvice(rows, { now: NOW }).candidates[0];
  assert.equal(result.status, 'observed_low');
  assert.equal(result.observedMinimumCents, 10000);
  assert.equal(result.checkoutVerified, false);
  assert.match(result.message, /无法保证未来/);
});
test('高于已采集最低时只提示观察，不预测再次降价', () => {
  const rows = [quote(172800000, 9000), quote(86400000, 11000), quote(60000, 10000)];
  const result = buyingAdvice(rows, { now: NOW }).candidates[0];
  assert.equal(result.status, 'above_observed_low');
  assert.match(result.message, /10.00/);
});
test('过期报价、优惠到期和缺货不能推荐立即购买', () => {
  assert.equal(buyingAdvice([quote(960000, 10000)], { now: NOW }).candidates[0].status, 'refresh_required');
  const expired = quote(60000, 10000, { pricing: { validUntil: '2026-10-05T11:59:30Z' } });
  assert.equal(buyingAdvice([expired], { now: NOW }).candidates[0].status, 'refresh_required');
  const rows = [quote(120000, 10000), quote(60000, 10000, { stock: 'out_of_stock' })];
  assert.equal(buyingAdvice(rows, { now: NOW }).candidates[0].status, 'needs_verification');
});
test('同观测时间以最新收到的缺货记录为准', () => {
  const first = quote(60000, 10000, { verifiedAt: undefined });
  const last = quote(60000, 10000, { stock: 'out_of_stock', verifiedAt: new Date(NOW).toISOString() });
  assert.equal(buyingAdvice([first, last], { now: NOW }).candidates[0].status, 'needs_verification');
});
test('不同颜色和优惠适用人群不借用历史样本', () => {
  const rows = [quote(172800000, 9000, { color: 'black' }),
    quote(86400000, 9500, { eligibilityKey: 'member-v1', offerEligibility: 'verified_account' }), quote(60000, 10000)];
  assert.equal(buyingAdvice(rows, { now: NOW }).candidates[0].status, 'insufficient_history');
});

test('原报价有效期早于所选优惠时也必须重新核验', () => {
  const row = quote(60000, 10000, {
    priceValidUntil: '2026-10-05T11:59:30Z',
    pricing: { validUntil: '2026-10-05T13:00:00Z' }
  });
  assert.equal(buyingAdvice([row], { now: NOW }).candidates[0].status, 'refresh_required');
});
test('缺货时不返回已确认优惠的领券步骤', () => {
  const row = quote(60000, 10000, { stock: 'out_of_stock', pricing: { complete: true,
    purchaseSteps: [{ text: '领取', url: 'https://shop.example/claim' }] } });
  assert.ok(buyingAdvice([row], { now: NOW }).candidates[0].purchaseSteps.every(step => step.url === null));
});

test('当前同条件来源可比较，但不同地区或资格不能混比', () => {
  const rows = [quote(60000, 10000), quote(60000, 9500, { sourceId: 'other', sourceName: 'Other source' }),
    quote(60000, 8000, { sourceId: 'region', shippingRegion: 'CN-11' }),
    quote(60000, 7000, { sourceId: 'member', offerEligibility: 'verified_account', eligibilityKey: 'member-v1' })];
  const result = buyingAdvice(rows, { now: NOW });
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].sourceCount, 2);
  assert.equal(result.comparisons[0].currentMinimumCents, 9500);
  assert.deepEqual(result.comparisons[0].cheapestSourceIds, ['other']);
});
test('未知条件、缺货或过期来源不加入当前来源比较', () => {
  const rows = [quote(60000, 10000), quote(60000, 9500, { sourceId: 'other', stock: 'out_of_stock' }),
    quote(960000, 9000, { sourceId: 'stale' }), quote(60000, 8000, { sourceId: 'unknown', shippingCents: null })];
  assert.deepEqual(buyingAdvice(rows, { now: NOW }).comparisons, []);
});

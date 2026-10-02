import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeHistory } from '../src/history.js';
const row = {
  sourceId: 'test', sourceName: 'Test source', sku: 'KX0493', size: 'L',
  currency: 'CNY', priceCents: 10000, shippingCents: 0,
  color: 'black', shippingRegion: 'CN-31', quantity: 1, stock: 'in_stock',
  offerEligibility: 'public', eligibilityKey: 'public', couponCoverage: 'complete',
  priceBasis: 'payable_item_price', observedAt: '2026-10-01T00:00:00Z'
};
test('一条完整记录仅汇总已采集区间，记录数和起止时间明确', () => {
  const summary = summarizeHistory([row]);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].count, 1);
  assert.equal(summary.groups[0].observedFrom, '2026-10-01T00:00:00.000Z');
  assert.equal(summary.groups[0].observedFrom, summary.groups[0].observedTo);
  assert.equal(summary.groups[0].minimumCents, 10000);
});
test('不同来源、颜色、地区和优惠适用人群分别汇总', () => {
  const summary = summarizeHistory([row,
    { ...row, sourceId: 'other' }, { ...row, color: 'blue' },
    { ...row, shippingRegion: 'CN-11' }, { ...row, eligibilityKey: 'member-a', offerEligibility: 'verified_account' }
  ]);
  assert.equal(summary.groups.length, 5);
  assert.ok(summary.groups.every(group => group.count === 1));
});
test('比较合计包含运费，并保留真实采集区间', () => {
  const summary = summarizeHistory([
    { ...row, priceCents: 9000, shippingCents: 2000 },
    { ...row, observedAt: '2026-10-02T00:00:00Z', priceCents: 10000, shippingCents: 0 }
  ]);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].minimumCents, 10000);
  assert.equal(summary.groups[0].count, 2);
  assert.equal(summary.groups[0].observedTo, '2026-10-02T00:00:00.000Z');
});
test('缺少购买条件的旧记录及缺货记录不产生最低价汇总', () => {
  const summary = summarizeHistory([
    { price: 0, observedAt: row.observedAt, comparable: true },
    { ...row, stock: 'out_of_stock' }, { ...row, shippingCents: null }
  ]);
  assert.deepEqual(summary.groups, []);
  assert.equal(summary.pendingCount, 3);
});

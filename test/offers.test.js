import test from 'node:test';
import assert from 'node:assert/strict';
import { solveOffers, purchaseSteps } from '../src/offers.js';
const NOW = Date.parse('2026-10-05T12:00:00Z');
const rule = (id, extra = {}) => ({
  id, label: id, sku: 'KX0493', size: 'L', confirmed: true,
  startsAt: '2026-10-05T00:00:00Z', endsAt: '2026-10-06T00:00:00Z',
  stage: 'platform', order: 0, type: 'fixed', amountCents: 1000,
  stackable: true, requirements: [], regions: [], ...extra
});
const solve = (offers, extra = {}) => solveOffers({
  itemCents: 10000, shippingCents: 500, offers, sku: 'KX0493', size: 'L',
  shippingRegion: 'CN-31', coverage: 'complete', now: NOW,
  allowedActionOrigins: ['https://shop.example'], ...extra
});
test('互斥优惠选择更便宜的组合，不重复叠加', () => {
  const plan = solve([rule('small', { exclusiveGroup: 'platform' }), rule('large', { exclusiveGroup: 'platform', amountCents: 2000 })]);
  assert.equal(plan.totalCents, 8500);
  assert.deepEqual(plan.applied.map(step => step.id), ['large']);
  assert.equal(plan.complete, true);
});
test('全局比较单张大券与多张可叠加券', () => {
  const plan = solve([rule('solo', { amountCents: 3000, stackable: false }),
    rule('a', { order: 1, amountCents: 2000 }), rule('b', { order: 2, amountCents: 1500 })]);
  assert.equal(plan.totalCents, 7000);
  assert.deepEqual(plan.applied.map(step => step.id), ['a', 'b']);
});
test('原价门槛和优惠后门槛按明确口径计算', () => {
  const store = rule('store', { stage: 'store', amountCents: 2000 });
  const platform = rule('platform', { minSpendCents: 9000, thresholdBasis: 'current_item' });
  assert.equal(solve([store, platform], { shippingCents: 0 }).totalCents, 8000);
  assert.equal(solve([store, { ...platform, thresholdBasis: 'original_item' }], { shippingCents: 0 }).totalCents, 7000);
});
test('支付折扣包含运费并解释前后总额', () => {
  const plan = solve([rule('store', { stage: 'store' }), rule('pay', {
    stage: 'payment', type: 'percent', discountBps: 1000, rounding: 'nearest', roundingTarget: 'payable'
  })]);
  assert.equal(plan.totalCents, 8550);
  assert.equal(plan.applied[1].beforeCents, 9500);
  assert.equal(plan.applied[1].discountCents, 950);
});
test('按折扣金额舍入与按实付舍入的一分钱差异明确', () => {
  const offer = rule('percent', { type: 'percent', discountBps: 5000, rounding: 'nearest', roundingTarget: 'payable' });
  assert.equal(solve([offer], { itemCents: 29, shippingCents: 0 }).totalCents, 15);
  assert.equal(solve([{ ...offer, roundingTarget: 'discount' }], { itemCents: 29, shippingCents: 0 }).totalCents, 14);
});
test('重复满减和折扣上限有效', () => {
  const repeated = rule('each', { type: 'each', minSpendCents: 3000, thresholdBasis: 'original_item', amountCents: 400, capCents: 1000 });
  assert.equal(solve([repeated], { shippingCents: 0 }).totalCents, 9000);
  const percent = rule('percent', { type: 'percent', discountBps: 3000, rounding: 'nearest', roundingTarget: 'payable', capCents: 1500 });
  assert.equal(solve([percent], { shippingCents: 0 }).totalCents, 8500);
});
test('未知会员资格不应用，也不输出确定优惠价', () => {
  const offer = rule('member', { requirements: [{ type: 'member' }] });
  const plan = solve([offer]);
  assert.equal(plan.totalCents, 10500);
  assert.equal(plan.complete, false);
  assert.equal(plan.excluded[0].status, 'unknown');
});
test('已核验会员资格可使用，已明确非会员不使用', () => {
  const offer = rule('member', { requirements: [{ type: 'member' }] });
  assert.equal(solve([offer], { buyer: { verified: true, eligibilityKey: 'member-v1', member: true } }).totalCents, 9500);
  const plan = solve([offer], { buyer: { verified: true, eligibilityKey: 'account-v1', member: false } });
  assert.equal(plan.totalCents, 10500);
  assert.equal(plan.complete, true);
  assert.equal(plan.excluded[0].status, 'ineligible');
  assert.equal(solve([offer], { buyer: { verified: true, eligibilityKey: 'public', member: true } }).complete, false);
});
test('新客、持券和支付资格必须同时满足', () => {
  const offer = rule('private', { requirements: [
    { type: 'new_customer' }, { type: 'owned_coupon', value: 'coupon-a' }, { type: 'payment_method', value: 'method-a' }
  ] });
  const buyer = { verified: true, eligibilityKey: 'account-v1', newCustomer: true, ownedCouponIds: ['coupon-a'], paymentMethods: ['method-a'] };
  assert.equal(solve([offer], { buyer }).totalCents, 9500);
  assert.equal(solve([offer], { buyer: { ...buyer, ownedCouponIds: [] } }).totalCents, 10500);
});
test('过期不使用，未来活动只给复核时间', () => {
  const plan = solve([
    rule('expired', { endsAt: '2026-10-05T12:00:00Z' }),
    rule('future', { startsAt: '2026-10-05T13:00:00Z' })
  ]);
  assert.equal(plan.totalCents, 10500);
  assert.equal(plan.applied.length, 0);
  assert.equal(plan.nextReviewAt, '2026-10-05T13:00:00Z');
});
test('可叠加规则顺序不明确时不能宣称最低价', () => {
  const plan = solve([rule('a'), rule('b')]);
  assert.equal(plan.complete, false);
  assert.equal(plan.applied.length, 0);
  assert.equal(plan.totalCents, 10500);
});
test('运费未知不计算支付券或确定总价', () => {
  const plan = solve([rule('pay', { stage: 'payment' })], { shippingCents: null });
  assert.equal(plan.totalCents, null);
  assert.equal(plan.complete, false);
  assert.equal(plan.applied.length, 0);
});
test('明确地区不匹配和其他商品优惠不使用', () => {
  const plan = solve([rule('region', { regions: ['CN-11'] }), rule('other', { sku: 'KX0491' })]);
  assert.equal(plan.totalCents, 10500);
  assert.equal(plan.complete, true);
});
test('未确认叠加或舍入口径保持待核验', () => {
  assert.equal(solve([rule('x', { stackable: undefined })]).complete, false);
  assert.equal(solve([rule('x', { type: 'percent', discountBps: 1000 })]).complete, false);
});
test('领券入口受白名单限制，已确认方案给领取与核对步骤', () => {
  assert.throws(() => solve([rule('unsafe', { claimRequired: true, claimUrl: 'https://fake.example/claim' })]), TypeError);
  const plan = solve([rule('safe', { claimRequired: true, claimUrl: 'https://shop.example/claim' })]);
  const steps = purchaseSteps(plan);
  assert.equal(steps[1].url, 'https://shop.example/claim');
  assert.match(steps.at(-1).text, /结账/);
  assert.equal(solve([rule('missing', { claimRequired: true })]).complete, false);
});
test('限制规则数量、重复 id、无效金额与零门槛每满减', () => {
  assert.throws(() => solve(Array.from({ length: 13 }, (_, i) => rule('x' + i))), TypeError);
  assert.throws(() => solve([rule('same'), rule('same')]), TypeError);
  assert.throws(() => solve([rule('x', { amountCents: 0.1 })]), TypeError);
  assert.throws(() => solve([rule('x', { type: 'each', minSpendCents: 0 })]), TypeError);
});
test('零元优惠不产生负金额且保留结账核验要求', () => {
  const plan = solve([rule('free', { amountCents: 20000 })], { shippingCents: 0 });
  assert.equal(plan.totalCents, 0);
  assert.equal(plan.complete, false);
});

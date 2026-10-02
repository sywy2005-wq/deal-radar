import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDeal } from '../src/deals.js';

test('按顺序叠加折扣、满减和立减并使用分计算', () => {
  assert.deepEqual(calculateDeal({ price: 999, offers: [
    { type: 'percent', value: 10, label: '九折' },
    { type: 'threshold', threshold: 800, value: 80, label: '满800减80' },
    { type: 'fixed', value: 20, label: '券' }
  ] }), { subtotal: 999, payable: 799.1, saved: 199.9, applied: [
    { label: '九折', discount: 99.9 }, { label: '满800减80', discount: 80 }, { label: '券', discount: 20 }
  ] });
});

test('跳过未启用优惠并拒绝非法值', () => {
  assert.equal(calculateDeal({ price: 100, offers: [{ type: 'fixed', value: 90, enabled: false }] }).payable, 100);
  assert.throws(() => calculateDeal({ price: -1 }), /非负数字/);
  assert.throws(() => calculateDeal({ price: 1, offers: [{ type: 'percent', value: 101 }] }), /介于/);
});

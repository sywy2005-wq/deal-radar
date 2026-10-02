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

test('拒绝空值、布尔值、多余小数和超范围金额', () => {
  for (const price of ['', ' ', null, true, false, {}, '0.001', 0.001, Infinity, 1e20, '1e2']) {
    assert.throws(() => calculateDeal({ price }), TypeError, String(price));
  }
  assert.equal(calculateDeal({ price: '0.01' }).payable, 0.01);
  assert.equal(calculateDeal({ price: '0.29' }).payable, 0.29);
});
test('数量和总金额溢出不能进入计算', () => {
  for (const quantity of [true, null, '', 0, 1.5, '1.5', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculateDeal({ price: 1, quantity }), TypeError);
  }
  assert.throws(() => calculateDeal({ price: 10000000000, quantity: 2 }), /安全范围/);
  assert.throws(() => calculateDeal({ price: 1e307, quantity: 2 }), TypeError);
});
test('折扣使用整数基点并按分四舍五入', () => {
  assert.equal(calculateDeal({ price: '0.29', offers: [{ type: 'percent', value: '50' }] }).payable, 0.15);
  assert.equal(calculateDeal({ price: '100', offers: [{ type: 'percent', value: '12.34' }] }).payable, 87.66);
  assert.throws(() => calculateDeal({ price: 100, offers: [{ type: 'percent', value: '12.345' }] }), TypeError);
  assert.throws(() => calculateDeal({ price: 100, offers: [{ type: 'fixed', value: true }] }), TypeError);
});
test('未达到门槛也必须拒绝非法的满减金额', () => {
  assert.throws(() => calculateDeal({ price: 1, offers: [{ type: 'threshold', threshold: 100, value: 'bad' }] }), TypeError);
  assert.throws(() => calculateDeal({ price: 1, offers: {} }), TypeError);
  assert.throws(() => calculateDeal({ price: 1, offers: [null] }), TypeError);
});

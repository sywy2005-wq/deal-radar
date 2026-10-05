import { moneyCents, quantityValue, multiplyCents, discountCents } from './money.js';

export function calculateDeal({ price, quantity = 1, offers = [] }) {
  const priceCents = moneyCents(price, '价格');
  const count = quantityValue(quantity);
  if (!Array.isArray(offers)) throw new TypeError('优惠必须是数组');
  const subtotal = multiplyCents(priceCents, count);
  let payable = subtotal;
  const applied = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new TypeError('优惠必须是对象');
    if (offer.enabled !== undefined && typeof offer.enabled !== 'boolean') throw new TypeError('优惠启用状态必须是布尔值');
    if (offer.enabled === false) continue;
    const before = payable;
    if (offer.type === 'percent') {
      const rate = moneyCents(offer.value, '折扣');
      if (rate > 10000) throw new TypeError('折扣必须介于 0 和 100');
      payable = discountCents(payable, rate);
    } else if (offer.type === 'fixed') {
      payable = Math.max(0, payable - moneyCents(offer.value, '立减金额'));
    } else if (offer.type === 'threshold') {
      const threshold = moneyCents(offer.threshold, '满减门槛');
      const discount = moneyCents(offer.value, '满减金额');
      if (payable >= threshold) payable = Math.max(0, payable - discount);
    } else {
      throw new TypeError(`不支持的优惠类型: ${offer.type}`);
    }
    if (before !== payable) applied.push({ label: String(offer.label || offer.type), discount: (before - payable) / 100 });
  }
  return { subtotal: subtotal / 100, payable: payable / 100, saved: (subtotal - payable) / 100, applied };
}

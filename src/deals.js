function money(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${field} 必须是非负数字`);
  return Math.round(number * 100);
}

export function calculateDeal({ price, quantity = 1, offers = [] }) {
  const priceCents = money(price, '价格');
  const count = Number(quantity);
  if (!Number.isInteger(count) || count < 1) throw new TypeError('数量必须是正整数');
  let subtotal = priceCents * count;
  let payable = subtotal;
  const applied = [];

  for (const offer of offers) {
    if (offer.enabled === false) continue;
    const before = payable;
    if (offer.type === 'percent') {
      const rate = Number(offer.value);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new TypeError('折扣必须介于 0 和 100');
      payable = Math.round(payable * (100 - rate) / 100);
    } else if (offer.type === 'fixed') {
      payable = Math.max(0, payable - money(offer.value, '立减金额'));
    } else if (offer.type === 'threshold') {
      const threshold = money(offer.threshold, '满减门槛');
      if (payable >= threshold) payable = Math.max(0, payable - money(offer.value, '满减金额'));
    } else {
      throw new TypeError(`不支持的优惠类型: ${offer.type}`);
    }
    if (before !== payable) applied.push({ label: offer.label || offer.type, discount: (before - payable) / 100 });
  }

  return { subtotal: subtotal / 100, payable: payable / 100, saved: (subtotal - payable) / 100, applied };
}

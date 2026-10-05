const MAX = 1000000000000n; // Integer cents; cap also keeps decimal yuan responses precise.

export function moneyCents(value, field = '金额') {
  if (typeof value !== 'number' && typeof value !== 'string') throw new TypeError(`${field} 必须是非负数字，最多两位小数`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${field} 必须是有限数字`);
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError(`${field} 必须是非负数字，最多两位小数`);
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (cents > MAX) throw new TypeError(`${field} 超出安全金额范围`);
  return Number(cents);
}

export function quantityValue(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value).trim())) throw new TypeError('数量必须是正整数');
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('数量必须是安全的正整数');
  return count;
}

export function addCents(left, right) {
  if (![left, right].every(value => Number.isSafeInteger(value) && value >= 0)) throw new TypeError('金额必须是安全的非负整数分');
  const total = BigInt(left) + BigInt(right);
  if (total > MAX) throw new TypeError('总金额超出安全范围');
  return Number(total);
}

export function multiplyCents(cents, count) {
  const total = BigInt(cents) * BigInt(count);
  if (total > MAX) throw new TypeError('总金额超出安全范围');
  return Number(total);
}

export function discountCents(cents, basisPoints) {
  return Number((BigInt(cents) * BigInt(10000 - basisPoints) + 5000n) / 10000n);
}

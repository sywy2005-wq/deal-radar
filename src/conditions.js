import { addCents } from './money.js';

export function comparisonConditions(quote) {
  const missing = [];
  if (quote.stock !== 'in_stock') missing.push(quote.stock === 'out_of_stock' ? '目标尺码无库存' : '库存待核验');
  if (typeof quote.color !== 'string' || !quote.color.trim()) missing.push('颜色待核验');
  if (typeof quote.shippingRegion !== 'string' || !quote.shippingRegion.trim()) missing.push('收货地区待核验');
  if (!Number.isSafeInteger(quote.shippingCents) || quote.shippingCents < 0) missing.push('运费待核验');
  if (quote.quantity !== 1) missing.push('单件购买条件待核验');
  if (!['public', 'verified_account'].includes(quote.offerEligibility)) missing.push('优惠资格待核验');
  if (typeof quote.eligibilityKey !== 'string' || !quote.eligibilityKey.trim()) missing.push('优惠适用人群待核验');
  if (quote.couponCoverage !== 'complete') missing.push('优惠完整性待核验');
  if (quote.priceBasis !== 'payable_item_price') missing.push('优惠后商品价格口径待核验');
  if (!Number.isSafeInteger(quote.priceCents) || quote.priceCents <= 0) missing.push('价格待核验');
  if (quote.currency !== 'CNY') missing.push('币种待核验');
  if (!quote.sourceId || quote.sku !== 'KX0493' || quote.size !== 'L') missing.push('来源或规格待核验');
  let totalCents = null;
  if (!missing.length) {
    try { totalCents = addCents(quote.priceCents, quote.shippingCents); }
    catch { missing.push('总金额超出安全范围'); }
  }
  return { comparable: missing.length === 0, needsVerification: missing, totalCents };
}

export function comparisonKey(quote) {
  return JSON.stringify([
    quote.sourceId, quote.sku, quote.size, quote.color, quote.currency,
    quote.shippingRegion, quote.quantity, quote.offerEligibility,
    quote.eligibilityKey, quote.couponCoverage, quote.priceBasis
  ]);
}

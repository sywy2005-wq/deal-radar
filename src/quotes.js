import { TARGET } from './catalog.js';
import { moneyCents, quantityValue } from './money.js';
import { comparisonConditions } from './conditions.js';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function validateQuote(raw, source, now = new Date()) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['响应不是对象'] };
  if (typeof raw.sku !== 'string' || raw.sku.toUpperCase() !== TARGET.sku) errors.push('货号不匹配');
  if (typeof raw.size !== 'string' || raw.size.toUpperCase() !== TARGET.size) errors.push('尺码不匹配');
  if (raw.currency !== TARGET.currency) errors.push('币种必须为 CNY');
  let priceCents;
  try { priceCents = moneyCents(raw.price, '价格'); if (priceCents <= 0) throw new TypeError('价格必须是正数'); }
  catch (error) { errors.push(error.message); }
  if (!timestamp(raw.observedAt)) errors.push('缺少有效的 observedAt');
  else {
    const age = now.valueOf() - Date.parse(raw.observedAt);
    if (!Number.isFinite(now.valueOf()) || !Number.isFinite(source.maxAgeMinutes) || source.maxAgeMinutes <= 0 || age < 0 || age > source.maxAgeMinutes * 60_000) errors.push('报价时间已过期或来自未来');
  }
  let productUrl;
  try {
    const endpoint = new URL(source.url);
    const product = new URL(raw.productUrl, endpoint);
    if (!text(raw.productUrl) || !['https:', 'http:'].includes(endpoint.protocol) || product.origin !== endpoint.origin || product.username || product.password || endpoint.username || endpoint.password) throw new TypeError();
    productUrl = product.href;
  } catch { errors.push('商品链接不属于数据源'); }
  let shippingCents = null;
  if (raw.shipping !== undefined && raw.shipping !== null) {
    try { shippingCents = moneyCents(raw.shipping, '运费'); }
    catch (error) { errors.push(error.message); }
  }
  let quantity = null;
  if (raw.quantity !== undefined && raw.quantity !== null) {
    try { quantity = quantityValue(raw.quantity); }
    catch (error) { errors.push(error.message); }
  }
  const stock = raw.stock ?? 'unknown';
  if (!['in_stock', 'out_of_stock', 'unknown'].includes(stock)) errors.push('库存状态无效');
  if (raw.offerEligibility !== undefined && !['public', 'verified_account', 'unknown'].includes(raw.offerEligibility)) errors.push('优惠资格状态无效');
  if (raw.couponCoverage !== undefined && !['complete', 'partial', 'unknown'].includes(raw.couponCoverage)) errors.push('优惠完整性状态无效');
  if (raw.priceBasis !== undefined && !['item_price', 'payable_item_price', 'unknown'].includes(raw.priceBasis)) errors.push('价格口径无效');
  if (errors.length) return { ok: false, errors };
  const quote = {
    sourceId: source.id, sourceName: source.name, sku: TARGET.sku, size: TARGET.size,
    currency: TARGET.currency, price: priceCents / 100, priceCents, productUrl,
    observedAt: new Date(raw.observedAt).toISOString(), verifiedAt: now.toISOString(),
    verificationLevel: 'field_checked', color: text(raw.color), stock,
    shippingCents, shippingRegion: text(raw.shippingRegion), quantity,
    offerEligibility: raw.offerEligibility ?? 'unknown',
    eligibilityKey: text(raw.eligibilityKey),
    couponCoverage: raw.couponCoverage ?? 'unknown',
    priceBasis: raw.priceBasis ?? 'unknown'
  };
  const conditions = comparisonConditions(quote);
  return { ok: true, quote: { ...quote, ...conditions, priceStatus: conditions.comparable ? 'ready_for_comparison' : 'needs_verification' } };
}

export async function fetchVerifiedQuote(source, { fetchImpl = fetch, now } = {}) {
  if (!source.enabled) return { ok: false, status: 'disabled', errors: ['数据源未启用'] };
  try {
    const response = await fetchImpl(source.url, {
      headers: { accept: 'application/json', 'user-agent': 'deal-radar/0.1' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { ok: false, status: 'error', errors: [`上游返回 HTTP ${response.status}`] };
    return { ...validateQuote(await response.json(), source, now ?? new Date()), status: 'checked' };
  } catch (error) {
    return { ok: false, status: 'error', errors: [`拉取失败: ${error.message}`] };
  }
}

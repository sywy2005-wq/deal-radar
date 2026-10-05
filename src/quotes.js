import { solveOffers, purchaseSteps } from './offers.js';
import { timestampMs } from './time.js';
import { createHash } from 'node:crypto';
import { TARGET } from './catalog.js';
import { moneyCents, quantityValue } from './money.js';
import { comparisonConditions } from './conditions.js';

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const timestamp = value => { try { timestampMs(value); return true; } catch { return false; } };

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
    if (!text(raw.productUrl) || !['https:', 'http:'].includes(endpoint.protocol) || !(source.allowedProductOrigins || [endpoint.origin]).includes(product.origin) || product.username || product.password || endpoint.username || endpoint.password) throw new TypeError();
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
  if (raw.priceValidUntil !== undefined) {
    try { if (timestampMs(raw.priceValidUntil) <= now.valueOf()) errors.push('优惠后报价已过期'); }
    catch { errors.push('优惠后报价有效期无效'); }
  }
  if (errors.length) return { ok: false, errors };
  const quote = {
    sourceId: source.id, sourceName: source.name, channel: source.channel || 'json', sku: TARGET.sku, size: TARGET.size,
    currency: TARGET.currency, price: priceCents / 100, priceCents, productUrl,
    observedAt: new Date(raw.observedAt).toISOString(), verifiedAt: now.toISOString(),
    verificationLevel: 'field_checked', color: text(raw.color), stock,
    shippingCents, shippingRegion: text(raw.shippingRegion), quantity,
    offerEligibility: raw.offerEligibility ?? 'unknown',
    eligibilityKey: text(raw.eligibilityKey),
    couponCoverage: raw.couponCoverage ?? 'unknown',
    priceBasis: raw.priceBasis ?? 'unknown',
    priceValidUntil: raw.priceValidUntil ?? null
  };
  if (raw.offers !== undefined) {
    if (!Array.isArray(raw.offers)) return { ok: false, errors: ['优惠规则必须是数组'] };
    if (quote.priceBasis === 'payable_item_price') {
      quote.pricing = { status: 'already_discounted', complete: false,
        validUntil: quote.priceValidUntil, needsVerification: ['来源报价已包含优惠，未再次扣减；领取步骤须核验'], applied: [], excluded: [] };
      if (raw.offers.length && !quote.priceValidUntil) quote.couponCoverage = 'partial';
    } else if (quote.priceBasis !== 'item_price' || quote.quantity !== 1) {
      quote.pricing = { status: 'needs_verification', complete: false, needsVerification: ['优惠计算需明确单件原价口径'], applied: [], excluded: [] };
    } else {
      try {
        const buyer = raw.buyerContext?.verified === true && raw.buyerContext.eligibilityKey === quote.eligibilityKey ? raw.buyerContext : null;
        const plan = solveOffers({
          itemCents: quote.priceCents, shippingCents: quote.shippingCents, offers: raw.offers,
          sku: TARGET.sku, size: TARGET.size, shippingRegion: quote.shippingRegion, buyer,
          coverage: quote.couponCoverage, now: now.valueOf(),
          allowedActionOrigins: source.allowedActionOrigins || source.allowedProductOrigins || [new URL(source.url).origin]
        });
        quote.pricing = { ...plan, purchaseSteps: purchaseSteps(plan) };
        if (plan.complete) {
          quote.priceCents = plan.itemCents; quote.price = plan.itemCents / 100;
          quote.shippingCents = plan.shippingCents; quote.priceBasis = 'payable_item_price';
          if (plan.usesPrivateEligibility) quote.offerEligibility = 'verified_account';
        } else quote.couponCoverage = 'partial';
      } catch { return { ok: false, errors: ['优惠规则或操作链接校验失败'] }; }
    }
  }
  const conditions = comparisonConditions(quote);
  return { ok: true, quote: { ...quote, ...conditions, priceStatus: conditions.comparable ? 'ready_for_comparison' : 'needs_verification' } };
}

export async function fetchVerifiedQuote(source, { fetchImpl = fetch, now } = {}) {
  if (!source.enabled) return { ok: false, status: 'disabled', errors: ['数据源未启用'] };
  try {
    const response = await fetchImpl(source.url, {
      headers: { accept: 'application/json', 'user-agent': 'deal-radar/0.1', ...(source.token ? { authorization: `Bearer ${source.token}` } : {}) },
      redirect: 'error',
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { ok: false, status: 'error', errors: [`上游返回 HTTP ${response.status}`] };
    let raw;
    if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 262144) throw new TypeError('上游响应过大');
        chunks.push(Buffer.from(chunk));
      }
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } else raw = await response.json();
    const serialized = JSON.stringify(raw);
    if (Buffer.byteLength(serialized) > 262144) throw new TypeError('上游响应过大');
    const checked = validateQuote(raw, source, now ?? new Date());
    if (checked.ok) checked.quote.evidence = {
      parserVersion: 'json-v3', receivedAt: checked.quote.verifiedAt,
      responseSha256: createHash('sha256').update(serialized).digest('hex'),
      rawResponse: raw
    };
    return { ...checked, status: 'checked' };
  } catch (error) {
    return { ok: false, status: 'error', errors: ['上游请求或响应处理失败'] };
  }
}

export function publicQuote(quote) {
  if (!quote.evidence) return quote;
  const { rawResponse, ...evidence } = quote.evidence;
  return { ...quote, evidence };
}
export function publicResults(results) {
  return results.map(result => result.ok ? { ...result, quote: publicQuote(result.quote) } : result);
}

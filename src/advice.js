import { comparisonConditions, comparisonKey } from './conditions.js';
import { timestampMs } from './time.js';

const observedTime = row => Number.isFinite(Date.parse(row.observedAt)) ? Date.parse(row.observedAt) : -Infinity;
const receivedTime = row => Number.isFinite(Date.parse(row.verifiedAt)) ? Date.parse(row.verifiedAt) : -Infinity;
const DEFAULT_STEPS = [{ text: '在商品页确认 KX0493、L 码、库存、运费和最终实付。', url: null }];
export function buyingAdvice(history, { now = Date.now(), staleMs = 900000 } = {}) {
  const latest = new Map();
  for (const row of history) {
    if (!row.sourceId || row.sku !== 'KX0493' || row.size !== 'L') continue;
    const time = observedTime(row), received = receivedTime(row);
    const prior = latest.get(row.sourceId);
    if (!prior || time > observedTime(prior) || (time === observedTime(prior) && received >= receivedTime(prior))) latest.set(row.sourceId, row);
  }
  const candidates = [];
  for (const quote of latest.values()) {
    const base = { sourceId: quote.sourceId, sourceName: quote.sourceName, productUrl: quote.productUrl,
      observedAt: quote.observedAt, color: quote.color, shippingRegion: quote.shippingRegion,
      eligibilityKey: quote.eligibilityKey, totalCents: null,
      purchaseSteps: DEFAULT_STEPS, nextReviewAt: null, checkoutVerified: false };
    const observed = Date.parse(quote.observedAt);
    if (!Number.isFinite(observed) || observed > now || now - observed > staleMs) {
      candidates.push({ ...base, status: 'refresh_required', message: '报价已过期或时间异常，请重新采集后再判断。' }); continue;
    }
    const validity = [quote.pricing?.validUntil, quote.priceValidUntil].filter(Boolean);
    let expired = false;
    try { expired = validity.some(value => timestampMs(value) <= now); } catch { expired = true; }
    if (expired) { candidates.push({ ...base, status: 'refresh_required', message: '所用优惠已到期，请重新核验，不能沿用旧的优惠价。' }); continue; }
    const conditions = comparisonConditions(quote);
    if (!conditions.comparable) {
      candidates.push({ ...base, status: 'needs_verification',
        message: `购买条件待核验：${conditions.needsVerification.join('；')}`,
        purchaseSteps: quote.pricing?.complete === false ? (quote.pricing.purchaseSteps || DEFAULT_STEPS) : DEFAULT_STEPS }); continue;
    }
    const key = comparisonKey(quote);
    const records = history.filter(row => comparisonKey(row) === key && comparisonConditions(row).comparable && Number.isFinite(Date.parse(row.observedAt)) && Date.parse(row.observedAt) <= now);
    const times = [...new Set(records.map(row => Date.parse(row.observedAt)))].sort((a, b) => a - b);
    const minimum = Math.min(...records.map(row => comparisonConditions(row).totalCents));
    const enough = times.length >= 3 && times.at(-1) - times[0] >= 86400000;
    const status = !enough ? 'insufficient_history' : (conditions.totalCents <= minimum ? 'observed_low' : 'above_observed_low');
    const message = status === 'insufficient_history'
      ? '同条件历史样本不足；可核对当前报价，尚不能判断购买时机。'
      : status === 'observed_low'
        ? '当前价处于已采集同条件区间低点，可前往结账核对；无法保证未来不会更低。'
        : `当前合计比已采集同条件最低值高 ${((conditions.totalCents - minimum) / 100).toFixed(2)} 元，可继续观察；历史价格是否再现无法确定。`;
    let nextReviewAt = null;
    try { if (quote.pricing?.nextReviewAt && timestampMs(quote.pricing.nextReviewAt) > now) nextReviewAt = quote.pricing.nextReviewAt; } catch {}
    candidates.push({ ...base, totalCents: conditions.totalCents, status, message,
      sampleCount: records.length, distinctObservations: times.length,
      observedFrom: new Date(times[0]).toISOString(), observedTo: new Date(times.at(-1)).toISOString(),
      observedMinimumCents: minimum, nextReviewAt,
      purchaseSteps: quote.pricing?.complete ? quote.pricing.purchaseSteps : DEFAULT_STEPS });
  }
  const groups = new Map();
  for (const candidate of candidates.filter(item => Number.isSafeInteger(item.totalCents))) {
    const row = latest.get(candidate.sourceId);
    const key = JSON.stringify(JSON.parse(comparisonKey(row)).slice(1));
    if (!groups.has(key)) groups.set(key, { color: row.color, shippingRegion: row.shippingRegion,
      eligibilityKey: row.eligibilityKey, quantity: row.quantity, currency: row.currency, quotes: [] });
    groups.get(key).quotes.push({ sourceId: candidate.sourceId, sourceName: candidate.sourceName,
      channel: row.channel || 'json', totalCents: candidate.totalCents, productUrl: candidate.productUrl });
  }
  const comparisons = [...groups.values()].filter(group => group.quotes.length >= 2).map(group => {
    group.quotes.sort((a, b) => a.totalCents - b.totalCents);
    return { ...group, sourceCount: group.quotes.length, currentMinimumCents: group.quotes[0].totalCents,
      cheapestSourceIds: group.quotes.filter(row => row.totalCents === group.quotes[0].totalCents).map(row => row.sourceId) };
  });
  return {
    status: candidates.length ? 'evidence_only' : 'waiting_for_data',
    message: candidates.length ? '建议仅依据采集记录和来源条件；付款前需结账核验。' : '尚无目标商品的真实报价，暂不提供购买时机或领券方案。',
    candidates, comparisons
  };
}

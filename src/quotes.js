import { TARGET } from './catalog.js';

export function validateQuote(raw, source, now = new Date()) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['响应不是对象'] };
  if (String(raw.sku).toUpperCase() !== TARGET.sku) errors.push('货号不匹配');
  if (String(raw.size).toUpperCase() !== TARGET.size) errors.push('尺码不匹配');
  if (raw.currency !== TARGET.currency) errors.push('币种必须为 CNY');
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) errors.push('价格必须是正数');
  const observedAt = new Date(raw.observedAt);
  if (Number.isNaN(observedAt.valueOf())) errors.push('缺少有效的 observedAt');
  else if (observedAt > now || now - observedAt > source.maxAgeMinutes * 60_000) errors.push('报价时间已过期或来自未来');
  if (!raw.productUrl || new URL(raw.productUrl, source.url).origin !== new URL(source.url).origin) errors.push('商品链接不属于数据源');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    quote: {
      sourceId: source.id, sourceName: source.name, sku: TARGET.sku, size: TARGET.size,
      currency: TARGET.currency, price: Math.round(price * 100) / 100,
      productUrl: new URL(raw.productUrl, source.url).href,
      observedAt: observedAt.toISOString(), verifiedAt: now.toISOString()
    }
  };
}

export async function fetchVerifiedQuote(source, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!source.enabled) return { ok: false, status: 'disabled', errors: ['数据源未启用'] };
  try {
    const response = await fetchImpl(source.url, { headers: { accept: 'application/json', 'user-agent': 'deal-radar/0.1' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { ok: false, status: 'error', errors: [`上游返回 HTTP ${response.status}`] };
    return { ...validateQuote(await response.json(), source, now), status: 'checked' };
  } catch (error) {
    return { ok: false, status: 'error', errors: [`拉取失败: ${error.message}`] };
  }
}

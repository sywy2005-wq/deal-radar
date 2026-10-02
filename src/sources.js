export function loadSources(env = process.env) {
  if (!env.QUOTE_SOURCE_URL) return [];
  const url = new URL(env.QUOTE_SOURCE_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new TypeError('数据源必须是无凭据的 HTTP(S) URL');
  const maxAgeMinutes = env.QUOTE_MAX_AGE_MINUTES === undefined ? 15 : Number(env.QUOTE_MAX_AGE_MINUTES);
  if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) throw new TypeError('报价有效期必须是有限的正数');
  return [{
    id: 'configured-json', name: env.QUOTE_SOURCE_NAME || '已配置 JSON 数据源',
    url: url.href, enabled: env.QUOTE_SOURCE_ENABLED === 'true', maxAgeMinutes
  }];
}

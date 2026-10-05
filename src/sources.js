import { readFileSync } from 'node:fs';

const defaultFile = new URL('../config/sources.json', import.meta.url);
export function loadSources(env = process.env, { readConfig = file => JSON.parse(readFileSync(file, 'utf8')) } = {}) {
  const entries = env.QUOTE_SOURCE_URL ? [{
    id: 'configured-json', name: env.QUOTE_SOURCE_NAME || '已配置 JSON 数据源',
    url: env.QUOTE_SOURCE_URL, enabled: env.QUOTE_SOURCE_ENABLED === 'true',
    reviewStatus: env.QUOTE_SOURCE_REVIEWED === 'true' ? 'verified' : 'pending',
    reviewEvidence: env.QUOTE_SOURCE_REVIEW_EVIDENCE,
    maxAgeMinutes: env.QUOTE_MAX_AGE_MINUTES ?? 15, tokenEnv: env.QUOTE_SOURCE_TOKEN_ENV
  }] : readConfig(env.QUOTE_SOURCES_FILE || defaultFile);
  if (!Array.isArray(entries)) throw new TypeError('数据源配置必须是数组');
  const ids = new Set();
  return entries.map(entry => {
    if (!entry || !/^[a-z0-9-]+$/.test(entry.id || '') || ids.has(entry.id)) throw new TypeError('数据源 id 必须有效且唯一');
    ids.add(entry.id);
    if (typeof entry.enabled !== 'boolean') throw new TypeError('数据源 enabled 必须是布尔值');
    let endpoint = null;
    if (entry.url) {
      endpoint = new URL(entry.url);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new TypeError('数据源必须是无凭据的 HTTPS URL');
    }
    const maxAgeMinutes = Number(entry.maxAgeMinutes ?? 15);
    if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0 || maxAgeMinutes > 15) throw new TypeError('报价有效期必须是十五分钟以内的有限正数');
    const allowedProductOrigins = entry.allowedProductOrigins?.length ? entry.allowedProductOrigins : (endpoint ? [endpoint.origin] : []);
    if (!Array.isArray(allowedProductOrigins)) throw new TypeError('商品域名白名单必须是数组');
    const allowedActionOrigins = entry.allowedActionOrigins ?? allowedProductOrigins;
    if (!Array.isArray(allowedActionOrigins)) throw new TypeError('优惠操作域名白名单必须是数组');
    for (const origin of [...allowedProductOrigins, ...allowedActionOrigins]) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin || url.hostname.includes('*') || url.username || url.password) throw new TypeError('商品域名白名单必须是 HTTPS origin');
    }
    if (entry.tokenEnv && !/^[A-Z][A-Z0-9_]*$/.test(entry.tokenEnv)) throw new TypeError('凭据变量名无效');
    const blockedReasons = [];
    if (!endpoint) blockedReasons.push('未配置授权接口');
    if (entry.reviewStatus !== 'verified' || typeof entry.reviewEvidence !== 'string' || !entry.reviewEvidence.trim()) blockedReasons.push('来源和商家待核验');
    if (entry.tokenEnv && !env[entry.tokenEnv]) blockedReasons.push('缺少接口凭据');
    const enabled = entry.enabled && blockedReasons.length === 0;
    return {
      id: entry.id, name: entry.name || entry.id, channel: entry.channel || 'json',
      url: endpoint?.href ?? null, enabled, maxAgeMinutes, allowedProductOrigins, allowedActionOrigins,
      reviewStatus: entry.reviewStatus || 'pending', reviewEvidence: entry.reviewEvidence || null,
      token: entry.tokenEnv ? env[entry.tokenEnv] : undefined,
      blockedReasons: enabled ? [] : (blockedReasons.length ? blockedReasons : ['运营方未启用'])
    };
  });
}

export function publicSources(sources) {
  return sources.map(({ id, name, channel, enabled, reviewStatus, blockedReasons }) => ({
    id, name, channel, enabled, reviewStatus, blockedReasons: blockedReasons || []
  }));
}

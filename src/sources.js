export function loadSources(env = process.env) {
  // No endpoint is trusted implicitly. Operators must explicitly configure AND enable it.
  if (!env.QUOTE_SOURCE_URL) return [];
  return [{
    id: 'configured-json', name: env.QUOTE_SOURCE_NAME || '已配置 JSON 数据源',
    url: env.QUOTE_SOURCE_URL, enabled: env.QUOTE_SOURCE_ENABLED === 'true',
    maxAgeMinutes: Number(env.QUOTE_MAX_AGE_MINUTES) || 30
  }];
}

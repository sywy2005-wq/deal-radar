import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSources, publicSources } from '../src/sources.js';
test('两个候选源默认关闭且不会假定已授权', () => {
  const sources = loadSources({});
  assert.equal(sources.length, 2);
  assert.ok(sources.every(source => !source.enabled));
  const [source] = loadSources({ QUOTE_SOURCE_URL: 'https://shop.example/api' });
  assert.equal(source.enabled, false);
  assert.equal(source.maxAgeMinutes, 15);
});
test('拒绝无限、过长时效和非 HTTPS 或带凭据的数据源', () => {
  for (const age of ['Infinity', '-1', '0', '16', 'bad', '']) {
    assert.throws(() => loadSources({ QUOTE_SOURCE_URL: 'https://shop.example/api', QUOTE_MAX_AGE_MINUTES: age }), TypeError);
  }
  for (const url of ['http://shop.example/api', 'file:///tmp/a', 'https://user:password@shop.example/api']) {
    assert.throws(() => loadSources({ QUOTE_SOURCE_URL: url }), TypeError);
  }
});
test('显式启用仍需来源核验与证据', () => {
  const base = { QUOTE_SOURCE_URL: 'https://shop.example/api', QUOTE_SOURCE_ENABLED: 'true' };
  assert.equal(loadSources(base)[0].enabled, false);
  assert.equal(loadSources({ ...base, QUOTE_SOURCE_REVIEWED: 'true' })[0].enabled, false);
  assert.equal(loadSources({ ...base, QUOTE_SOURCE_REVIEWED: 'true', QUOTE_SOURCE_REVIEW_EVIDENCE: 'test-review' })[0].enabled, true);
});
test('多来源凭据绑定及公开状态不泄露秘密', () => {
  const config = [{ id: 'test', name: 'Test', enabled: true, reviewStatus: 'verified',
    reviewEvidence: 'test-review', url: 'https://api.example/data',
    allowedProductOrigins: ['https://shop.example'], tokenEnv: 'TEST_TOKEN' }];
  const readConfig = () => config;
  assert.equal(loadSources({}, { readConfig })[0].enabled, false);
  const sources = loadSources({ TEST_TOKEN: 'secret-test-only' }, { readConfig });
  assert.equal(sources[0].enabled, true);
  assert.equal(sources[0].token, 'secret-test-only');
  const serialized = JSON.stringify(publicSources(sources));
  assert.ok(!serialized.includes('secret-test-only'));
  assert.ok(!serialized.includes('api.example'));
  assert.ok(!serialized.includes('test-review'));
});
test('拒绝重复来源和通配符商品域名', () => {
  const entry = { id: 'test', enabled: false };
  assert.throws(() => loadSources({}, { readConfig: () => [entry, entry] }), TypeError);
  assert.throws(() => loadSources({}, { readConfig: () => [{ ...entry, allowedProductOrigins: ['https://*.example'] }] }), TypeError);
});

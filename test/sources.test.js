import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSources } from '../src/sources.js';
test('数据源默认关闭且有效期为十五分钟', () => {
  assert.deepEqual(loadSources({}), []);
  const [source] = loadSources({ QUOTE_SOURCE_URL: 'https://shop.example/api' });
  assert.equal(source.enabled, false);
  assert.equal(source.maxAgeMinutes, 15);
});
test('拒绝无限时效、非 HTTP(S) 或带凭据的数据源', () => {
  for (const age of ['Infinity', '-1', '0', 'bad', '']) {
    assert.throws(() => loadSources({ QUOTE_SOURCE_URL: 'https://shop.example/api', QUOTE_MAX_AGE_MINUTES: age }), TypeError);
  }
  for (const url of ['file:///tmp/a', 'https://user:password@shop.example/api']) {
    assert.throws(() => loadSources({ QUOTE_SOURCE_URL: url }), TypeError);
  }
});

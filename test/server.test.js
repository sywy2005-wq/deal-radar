import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

test('状态接口明确没有真实历史', async t => {
  const server = createApp({ sources: [], quoteStore: { list: async () => [], add: async () => {} } });
  await new Promise(resolve => server.listen(0, resolve)); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.target.sku, 'KX0493'); assert.equal(body.hasVerifiedHistory, false);
});

test('字段校验通过不宣称结账核验，缺失条件不产生最低价', async t => {
  const history = [{
    sourceId: 'test', sku: 'KX0493', size: 'L', currency: 'CNY', price: 699,
    observedAt: '2026-10-02T00:00:00Z', verifiedAt: '2026-10-02T00:01:00Z'
  }];
  const server = createApp({ sources: [], quoteStore: { list: async () => history } });
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/status`)).json();
  assert.equal(body.hasObservedHistory, true);
  assert.equal(body.hasVerifiedHistory, false);
  assert.equal(body.historySummary.pendingCount, 1);
  assert.deepEqual(body.historySummary.groups, []);
});

test('状态接口展示采集状态且隐藏原始响应', async t => {
  const history = [{
    sourceId: 'test', sku: 'KX0493', size: 'L', currency: 'CNY', price: 100,
    evidence: { parserVersion: 'json-v2', responseSha256: 'test-hash', rawResponse: { privateField: 'test-private' } }
  }];
  const server = createApp({ sources: [], quoteStore: { list: async () => history },
    collector: { status: () => ({ enabled: false, running: false }) } });
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const body = await (await fetch(`http://127.0.0.1:${server.address().port}/api/status`)).json();
  assert.equal(body.collection.running, false);
  assert.equal(body.history[0].evidence.rawResponse, undefined);
  assert.equal(body.history[0].evidence.responseSha256, 'test-hash');
});

test('默认购买建议为空，页面包含购买辅助区域', async t => {
  const server = createApp({ sources: [], quoteStore: { list: async () => [] } });
  await new Promise(resolve => server.listen(0, resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = await (await fetch(origin + '/api/status')).json();
  assert.equal(body.buyingAdvice.status, 'waiting_for_data');
  assert.deepEqual(body.buyingAdvice.candidates, []);
  const html = await (await fetch(origin)).text();
  assert.match(html, /购买时机与方法/);
});

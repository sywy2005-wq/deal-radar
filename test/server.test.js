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

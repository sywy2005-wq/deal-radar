import test from 'node:test';
import assert from 'node:assert/strict';
import { timestampMs } from '../src/time.js';
test('日期必须真实存在，带明确时区', () => {
  assert.equal(timestampMs('2024-02-29T12:00:00Z'), Date.parse('2024-02-29T12:00:00Z'));
  for (const value of ['2026-02-30T12:00:00Z', '2026-02-29T12:00:00Z', '2026-10-05T12:00:00', '2026-10-05T24:00:00Z', null]) {
    assert.throws(() => timestampMs(value), TypeError);
  }
});

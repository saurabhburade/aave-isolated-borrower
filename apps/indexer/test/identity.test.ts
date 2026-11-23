import assert from 'node:assert/strict';
import test from 'node:test';
import { logId, positionId } from '../src/identity.ts';

test('position identity is chain-qualified and account-normalized', () => {
  assert.equal(positionId(31337, '0xAbC'), '31337/0xabc');
  assert.notEqual(positionId(1, '0xabc'), positionId(31337, '0xabc'));
});

test('event identity is chain-qualified and log-specific', () => {
  assert.equal(logId(31337, '0xABC', 4), '31337:0xabc:4');
  assert.notEqual(logId(31337, '0xabc', 4), logId(31337, '0xabc', 5));
  assert.notEqual(logId(1, '0xabc', 4), logId(31337, '0xabc', 4));
});

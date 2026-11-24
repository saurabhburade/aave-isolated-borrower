import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult, parseAbi } from 'viem';
import { nativeExecutionFailure } from './native-errors.ts';

test('native failures preserve contract reasons and distinguish health and rate limits', () => {
  const abi = parseAbi([
    'error Error(string reason)',
    'error Unhealthy(uint256 actual,uint256 required)',
    'error BorrowRateExceeded(uint256 actual,uint256 maximum)',
    'error TokenCallFailed(address token)',
  ]);
  assert.equal(nativeExecutionFailure(encodeErrorResult({ abi, errorName: 'Error', args: ['SUPPLY_CAP_EXCEEDED'] })).reason, 'Native execution reverted: SUPPLY_CAP_EXCEEDED');
  assert.match(nativeExecutionFailure(encodeErrorResult({ abi, errorName: 'Unhealthy', args: [1100000000000000000n, 1200000000000000000n] })).reason, /health factor is 1.1.*required 1.2/);
  assert.match(nativeExecutionFailure(encodeErrorResult({ abi, errorName: 'BorrowRateExceeded', args: [2n, 1n] })).reason, /borrow rate exceeds the reviewed maximum/);
  assert.match(nativeExecutionFailure(encodeErrorResult({ abi, errorName: 'TokenCallFailed', args: ['0x0000000000000000000000000000000000000001'] })).reason, /token transfer failed/);
});

test('unknown or empty native failures remain visible without fabricating a cause', () => {
  assert.deepEqual(nativeExecutionFailure('0xdeadbeef'), { reason: 'Native execution reverted with error 0xdeadbeef.' });
  assert.deepEqual(nativeExecutionFailure('0x'), { reason: 'Native execution reverted without a reason.' });
});

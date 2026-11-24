import { decodeErrorResult, formatUnits, parseAbi, type Hex } from 'viem';
import type { MarketQuote } from './domain.ts';

const nativeErrorAbi = parseAbi([
  'error Error(string reason)',
  'error Panic(uint256 code)',
  'error PositionAlreadyExists(address account)',
  'error TokenCallFailed(address token)',
  'error InvalidPlan()',
  'error InvalidLimits()',
  'error Unauthorized()',
  'error UnsupportedVersion()',
  'error Reentered()',
  'error InvalidReserve()',
  'error InvalidAction()',
  'error AmountUnavailable()',
  'error Unhealthy(uint256 actual,uint256 required)',
  'error BorrowRateExceeded(uint256 actual,uint256 maximum)',
]);

export function nativeExecutionFailure(data: Hex): { reason: string; executionError?: MarketQuote['executionError'] } {
  try {
    const error = decodeErrorResult({ abi: nativeErrorAbi, data });
    switch (error.errorName) {
      case 'PositionAlreadyExists': return { executionError: 'position_exists', reason: 'Position already exists for this creation request. Start a new position to continue.' };
      case 'TokenCallFailed': return { reason: 'Collateral token transfer failed. Check your token balance and approvals before retrying.' };
      case 'Unhealthy': return { reason: `The resulting health factor is ${formatUnits(error.args[0], 18)}, below the required ${formatUnits(error.args[1], 18)}.` };
      case 'BorrowRateExceeded': return { reason: 'The resulting borrow rate exceeds the reviewed maximum. Refresh the quote before retrying.' };
      case 'InvalidPlan': return { reason: 'The execution plan is invalid or expired. Refresh the quote before retrying.' };
      case 'InvalidLimits': return { reason: 'The execution risk limits are invalid. Refresh the quote before retrying.' };
      case 'AmountUnavailable': return { reason: 'The requested amount is unavailable in this position.' };
      case 'InvalidReserve': return { reason: 'The selected reserve does not match this market.' };
      case 'InvalidAction': return { reason: 'The requested action is invalid for this market.' };
      case 'Unauthorized': return { reason: 'The connected wallet is not authorized to execute this position.' };
      case 'Error': return { reason: `Native execution reverted: ${String(error.args[0]).slice(0, 240)}` };
      default: return { reason: `Native execution reverted: ${error.errorName}.` };
    }
  } catch {
    return { reason: data === '0x' ? 'Native execution reverted without a reason.' : `Native execution reverted with error ${data.slice(0, 10)}.` };
  }
}

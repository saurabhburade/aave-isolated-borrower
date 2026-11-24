import { getAddress, isAddress, parseUnits, type Address, type Hex } from 'viem';
import type { BorrowRequest, ManagementAction, ProtocolVersion } from './domain.ts';

export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_RPC_URL = 'http://127.0.0.1:8557';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const MAX_UINT256 = (1n << 256n) - 1n;

export function normalizeAddress(value: unknown, field = 'address'): Address {
  if (typeof value !== 'string' || !isAddress(value, { strict: false })) throw new Error(`Invalid ${field}.`);
  return getAddress(value) as Address;
}

export function decimalAmount(value: unknown, decimals: number, field = 'amount'): bigint {
  if (typeof value !== 'string' || value.length === 0 || value.length > 78 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`Invalid ${field}.`);
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > decimals) throw new Error(`${field} has too many decimal places.`);
  const parsed = parseUnits(value, decimals);
  if (parsed <= 0n) throw new Error(`${field} must be greater than zero.`);
  return parsed;
}

export function optionalDecimalAmount(value: unknown, decimals: number, field = 'amount'): bigint | undefined {
  if (value === undefined) return undefined;
  return decimalAmount(value, decimals, field);
}

export function assertSalt(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('salt must be a 32-byte hex value.');
  return value as Hex;
}

export function assertProtocolVersion(value: unknown): ProtocolVersion {
  if (value !== 3 && value !== 4) throw new Error('Unsupported protocol version.');
  return value;
}

export function validateBorrowRequest(input: unknown): BorrowRequest {
  if (!input || typeof input !== 'object') throw new Error('Borrow request is required.');
  const body = input as Record<string, unknown>;
  if (body.chainId !== LOCAL_CHAIN_ID) throw new Error('Only the verified local chain is available.');
  if (!Array.isArray(body.collaterals) || body.collaterals.length === 0) throw new Error('At least one collateral is required.');
  const seen = new Set<string>();
  const collaterals = body.collaterals.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Invalid collateral ${index + 1}.`);
    const row = raw as Record<string, unknown>;
    if (typeof row.assetId !== 'string' || row.assetId.length < 3) throw new Error(`Invalid collateral asset ${index + 1}.`);
    if (seen.has(row.assetId)) throw new Error('A collateral reserve may only appear once.');
    seen.add(row.assetId);
    decimalAmount(row.amount, 36, `collateral ${index + 1}`);
    if (typeof row.enabled !== 'boolean') throw new Error(`Collateral ${index + 1} enabled flag is required.`);
    return { assetId: row.assetId, amount: row.amount as string, enabled: row.enabled };
  });
  if (!body.debt || typeof body.debt !== 'object') throw new Error('A debt asset is required.');
  const debt = body.debt as Record<string, unknown>;
  if (typeof debt.assetId !== 'string' || debt.assetId.length < 3) throw new Error('Invalid debt asset.');
  decimalAmount(debt.amount, 36, 'debt amount');
  if (seen.has(debt.assetId)) throw new Error('The debt reserve must differ from collateral reserves.');
  return { chainId: LOCAL_CHAIN_ID, collaterals, debt: { assetId: debt.assetId, amount: debt.amount as string } };
}

export function validateManagementActions(input: unknown): ManagementAction[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) throw new Error('One to 32 management actions are required.');
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Invalid management action ${index + 1}.`);
    const action = raw as Record<string, unknown>;
    const kinds = new Set(['supply', 'withdraw', 'borrow', 'repay', 'repay-all', 'set-collateral', 'close']);
    if (typeof action.kind !== 'string' || !kinds.has(action.kind)) throw new Error(`Unsupported management action ${index + 1}.`);
    if (action.kind === 'close') return { kind: 'close', assetId: typeof action.assetId === 'string' && action.assetId.length >= 3 ? action.assetId : 'all' };
    if (typeof action.assetId !== 'string' || action.assetId.length < 3) throw new Error(`Invalid management asset ${index + 1}.`);
    if (action.kind === 'set-collateral') {
      if (typeof action.enabled !== 'boolean') throw new Error(`Action ${index + 1} requires enabled.`);
    } else if (action.kind !== 'close' && action.kind !== 'repay-all') {
      decimalAmount(action.amount, 36, `action ${index + 1} amount`);
    }
    return action as unknown as ManagementAction;
  });
}

export function localAddress(value: unknown, field = 'address'): Address {
  const address = normalizeAddress(value, field);
  if (address === ZERO_ADDRESS) throw new Error(`${field} cannot be the zero address.`);
  return address;
}

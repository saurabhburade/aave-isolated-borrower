import { indexer } from 'envio';
import { logId, positionId } from '../identity.ts';

// PositionAccount addresses are not known at startup. HyperIndex v3 supports
// registering them from the factory event before account handlers run.
indexer.contractRegister(
  { contract: 'PositionFactory', event: 'PositionCreated' },
  async ({ event, context }) => {
    context.chain.PositionAccount.add(event.params.account);
  },
);

indexer.onEvent(
  { contract: 'PositionFactory', event: 'PositionCreated', fields: { transaction: ['hash'] } },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const account = event.params.account;
    context.Position.set({
      id: positionId(chainId, account),
      chainId,
      account: account.toLowerCase(),
      owner: event.params.owner.toLowerCase(),
      venue: event.params.venue.toLowerCase(),
      version: Number(event.params.version),
      salt: event.params.salt,
      createdBlock: BigInt(event.block.number),
      createdTransaction: event.transaction.hash,
      latestBlock: BigInt(event.block.number),
      status: 'unknown',
    });
  },
);

indexer.onEvent(
  { contract: 'PositionAccount', event: 'PositionAction', fields: { transaction: ['hash'] } },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const id = positionId(chainId, event.srcAddress);
    const position = await context.Position.get(id);
    if (!position) return;
    context.PositionAction.set({
      id: logId(chainId, event.transaction.hash, event.logIndex),
      chainId,
      position_id: id,
      owner: event.params.owner.toLowerCase(),
      kind: Number(event.params.kind),
      token: event.params.token.toLowerCase(),
      reserveId: event.params.reserveId,
      amount: event.params.amount,
      enabled: event.params.enabled,
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    context.Position.set({ ...position, latestBlock: BigInt(event.block.number) });
  },
);

indexer.onEvent(
  { contract: 'PositionAccount', event: 'AccountExecuted', fields: { transaction: ['hash'] } },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const id = positionId(chainId, event.srcAddress);
    const position = await context.Position.get(id);
    if (!position) return;
    context.AccountExecution.set({
      id: logId(chainId, event.transaction.hash, event.logIndex),
      chainId,
      position_id: id,
      owner: event.params.owner.toLowerCase(),
      actionCount: event.params.actionCount,
      blockNumber: BigInt(event.block.number),
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
    context.Position.set({ ...position, latestBlock: BigInt(event.block.number) });
  },
);

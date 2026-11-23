export function positionId(chainId: number, account: string): string {
  return `${chainId}/${account.toLowerCase()}`;
}

export function logId(chainId: number, transactionHash: string, logIndex: number): string {
  return `${chainId}:${transactionHash.toLowerCase()}:${logIndex}`;
}

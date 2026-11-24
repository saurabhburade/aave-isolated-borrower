export type Network = { id: number; name: string; logo: string; quotingEnabled: boolean };
export const networks: Network[] = [{ id: 31337, name: 'Anvil', logo: '/networks/ethereum.svg', quotingEnabled: true }];
export const getNetwork = (chainId: number) => networks.find(network => network.id === chainId);

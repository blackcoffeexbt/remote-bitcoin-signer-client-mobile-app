import { networks } from 'bitcoinjs-lib';

export type BitcoinNetwork = 'Mainnet' | 'Testnet4';
export const DEFAULT_NETWORK: BitcoinNetwork = 'Mainnet';
export const NETWORKS = {
  Mainnet: {
    bitcoin: networks.bitcoin, coinType: 0, path: "m/84'/0'/0'",
    genesis: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
    server: 'ssl://mempool.space:50002',
    fees: 'https://mempool.space/api/v1/fees/recommended',
  },
  Testnet4: {
    bitcoin: networks.testnet, coinType: 1, path: "m/84'/1'/0'",
    genesis: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
    server: 'ssl://mempool.space:40002',
    fees: 'https://mempool.space/testnet4/api/v1/fees/recommended',
  },
} as const;
export function isNetwork(value: unknown): value is BitcoinNetwork { return value === 'Mainnet' || value === 'Testnet4'; }
export function accountNetwork(account: { path: string }): BitcoinNetwork {
  if (account.path === NETWORKS.Mainnet.path) return 'Mainnet';
  if (account.path === NETWORKS.Testnet4.path) return 'Testnet4';
  throw new Error('Unsupported signer account path');
}
export function networkMismatch(selected: BitcoinNetwork, device: BitcoinNetwork) {
  return `Bitcoin network mismatch: app is on ${selected}, device is on ${device}. Signing is blocked. Select ${device} in Settings > Bitcoin network.`;
}

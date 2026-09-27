import { Transaction } from 'bitcoinjs-lib';
import type { HistoryCache, Snapshot } from './wallet.ts';
import type { Journal } from './recovery.ts';

export const MAX_HISTORY_BYTES = 16 * 1024 * 1024;
export function decodeHistory(text: string, xpub: string, server: string): HistoryCache {
  if (text.length > MAX_HISTORY_BYTES) throw new Error('History cache too large');
  const cache = JSON.parse(text) as HistoryCache;
  if (!cache || cache.version !== 1 || cache.xpub !== xpub || cache.server !== server ||
    !Number.isSafeInteger(cache.height) || cache.height < 0 ||
    !Number.isSafeInteger(cache.syncedAt) || cache.syncedAt < 0 ||
    !cache.addressCounts || ![cache.addressCounts.receive, cache.addressCounts.change].every(n => Number.isSafeInteger(n) && n >= 20 && n <= 1000) ||
    !Array.isArray(cache.transactions) || cache.transactions.length > 2000) throw new Error('Invalid history cache');
  const seen = new Set<string>();
  for (const tx of cache.transactions) {
    if (!tx || typeof tx.txid !== 'string' || !/^[0-9a-f]{64}$/.test(tx.txid) || seen.has(tx.txid) ||
      !Number.isSafeInteger(tx.height) || tx.height < -1 || tx.height > cache.height ||
      typeof tx.raw !== 'string' || tx.raw.length < 20 || tx.raw.length > 2000000 || tx.raw.length % 2 ||
      !/^[0-9a-fA-F]+$/.test(tx.raw) || Transaction.fromHex(tx.raw).getId() !== tx.txid) throw new Error('Invalid history transaction');
    seen.add(tx.txid);
  }
  return cache;
}
export function cacheHistory(snapshot: Snapshot, server: string): HistoryCache {
  return { version: 1, xpub: snapshot.xpub, server, height: snapshot.height, syncedAt: snapshot.syncedAt,
    addressCounts: { receive: snapshot.addresses.filter(a => a.branch === 0).length, change: snapshot.addresses.filter(a => a.branch === 1).length },
    transactions: snapshot.transactions };
}
export async function readHistory(journal: Journal, xpub: string, server: string): Promise<HistoryCache | null> {
  // History is disposable. A damaged cache is rebuilt from the server, never
  // confused with the independently protected signed-payment recovery journal.
  try {
    const head = await journal.readHead();
    if (head !== 'a' && head !== 'b') return null;
    const text = await journal.read(head);
    return text === null ? null : decodeHistory(text, xpub, server);
  } catch { return null; }
}
export async function writeHistory(journal: Journal, cache: HistoryCache) {
  const text = JSON.stringify(cache);
  decodeHistory(text, cache.xpub, cache.server);
  const head = await journal.readHead(), slot = head === 'a' ? 'b' : 'a';
  await journal.write(slot, text);
  if (await journal.read(slot) !== text) throw new Error('Could not save transaction history');
  await journal.writeHead(slot);
}

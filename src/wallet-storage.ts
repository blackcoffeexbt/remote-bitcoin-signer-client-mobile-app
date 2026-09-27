import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { sha256 } from '@noble/hashes/sha2.js';
import { hex } from './bitcoin';
import { parseEndpoint } from './electrum';
import { GAP, parseGapLimit, validateCursor, validateGapLimit } from './wallet';
import type { AddressCursor, HistoryCache } from './wallet';
import type { PublicAccount } from './protocol';
import { readRecovery, writeRecovery, clearRecovery } from './recovery';
import type { Journal, SavedPayment } from './recovery';
import { MAX_HISTORY_BYTES, readHistory, writeHistory } from './history-cache';
export type { SavedPayment } from './recovery';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const accountId = (account: PublicAccount) => hex(sha256(new TextEncoder().encode(account.xpub)));
export async function loadServer() { return (await SecureStore.getItemAsync('wallet.electrs.v1')) ?? ''; }
export async function saveServer(value: string) { await SecureStore.setItemAsync('wallet.electrs.v1', parseEndpoint(value).url, options); }
export async function loadGapLimit() {
  const value = await SecureStore.getItemAsync('wallet.gap-limit.v1');
  return value === null ? GAP : parseGapLimit(value);
}
export async function saveGapLimit(value: number) {
  await SecureStore.setItemAsync('wallet.gap-limit.v1', String(validateGapLimit(value)), options);
}
export async function loadCursor(account: PublicAccount): Promise<AddressCursor> {
  const raw = await SecureStore.getItemAsync(`wallet.cursor.${accountId(account)}`);
  return raw ? validateCursor(JSON.parse(raw)) : { receive: 0, change: 0 };
}
export async function saveCursor(account: PublicAccount, cursor: AddressCursor) {
  const old = await loadCursor(account);
  await SecureStore.setItemAsync(`wallet.cursor.${accountId(account)}`, JSON.stringify(validateCursor({ receive: Math.max(old.receive, cursor.receive), change: Math.max(old.change, cursor.change) })), options);
}
function journal(account: PublicAccount): Journal {
  const id = accountId(account), key = `wallet.payment.${id}`;
  const file = (slot: string) => new File(Paths.document, `payment-${id}${slot === 'legacy' ? '' : '-' + slot}.json`);
  return {
    readHead: () => SecureStore.getItemAsync(key),
    writeHead: value => value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value, options),
    read: async slot => { const f = file(slot); if (!f.exists) return null; if (f.size > 130000) throw new Error('Saved payment is too large'); return f.text(); },
    write: async (slot, text) => { const f = file(slot); f.create({ overwrite: true }); f.write(text); },
    remove: async slot => { const f = file(slot); if (f.exists) f.delete(); },
  };
}
export const loadPayment = (account: PublicAccount) => readRecovery(journal(account), account);
export const savePayment = (account: PublicAccount, payment: SavedPayment) => writeRecovery(journal(account), account, payment);
export const clearPayment = (account: PublicAccount) => clearRecovery(journal(account));

function historyJournal(account: PublicAccount, server: string): Journal {
  const id = `${accountId(account)}-${hex(sha256(new TextEncoder().encode(server)))}`;
  const key = `wallet.history.${id}`;
  const file = (slot: string) => new File(Paths.document, `history-${id}-${slot}.json`);
  return {
    readHead: () => SecureStore.getItemAsync(key),
    writeHead: value => value === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, value, options),
    read: async slot => { const f = file(slot); if (!f.exists) return null; if (f.size > MAX_HISTORY_BYTES) throw new Error('History cache too large'); return f.text(); },
    write: async (slot, text) => { const f = file(slot); f.create({ overwrite: true }); f.write(text); },
    remove: async slot => { const f = file(slot); if (f.exists) f.delete(); },
  };
}
export const loadHistory = (account: PublicAccount, server: string) => readHistory(historyJournal(account, server), account.xpub, server);
let historyWrites = Promise.resolve();
export function saveHistory(account: PublicAccount, cache: HistoryCache) {
  const result = historyWrites.then(() => writeHistory(historyJournal(account, cache.server), cache));
  historyWrites = result.catch(() => {});
  return result;
}

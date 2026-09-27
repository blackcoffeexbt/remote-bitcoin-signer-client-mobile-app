import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Transaction } from 'bitcoinjs-lib';
import { fixture } from './fixtures.ts';
import { cachedHistory } from '../src/wallet.ts';
import type { HistoryCache } from '../src/wallet.ts';
import { decodeHistory, MAX_HISTORY_BYTES, readHistory, writeHistory } from '../src/history-cache.ts';
import type { Journal } from '../src/recovery.ts';

function setup() {
  const { account, psbt } = fixture(), files = new Map<string, string>();
  const raw = Buffer.from(psbt.data.inputs[0].nonWitnessUtxo!).toString('hex');
  const cache: HistoryCache = { version: 1, xpub: account.xpub, server: 'ssl://example.com:50002', height: 150, syncedAt: 123,
    addressCounts: { receive: 21, change: 20 }, transactions: [{ txid: Transaction.fromHex(raw).getId(), height: 145, raw }] };
  let pointer: string | null = null;
  const journal: Journal = {
    readHead: async () => pointer, writeHead: async value => { pointer = value; },
    read: async slot => files.get(slot) ?? null, write: async (slot, text) => { files.set(slot, text); },
    remove: async slot => { files.delete(slot); },
  };
  return { account, cache, files, journal };
}
test('stored history restores amounts and details without restoring spendable coins', async () => {
  const { account, cache, journal } = setup();
  assert.equal(await readHistory(journal, account.xpub, cache.server), null);
  await writeHistory(journal, cache);
  const loaded = (await readHistory(journal, account.xpub, cache.server))!;
  assert.deepEqual(loaded, cache);
  const history = cachedHistory(loaded, account);
  assert.equal(history[0].amount, 100000n); assert.equal(history[0].direction, 'received');
  assert.equal(history[0].outputs[0].owned, true);
  assert.equal('coins' in loaded, false);
  assert.equal(await readHistory(journal, 'different-wallet', cache.server), null);
  assert.equal(await readHistory(journal, account.xpub, 'ssl://other.com:50002'), null);
});
test('partial writes and failed pointer updates preserve previously saved history', async () => {
  const { account, cache, journal, files } = setup();
  await writeHistory(journal, cache);
  const changed = { ...cache, height: 151 };
  await assert.rejects(writeHistory({ ...journal, write: async (slot, text) => { files.set(slot, text.slice(0, 40)); } }, changed), /Could not save/);
  assert.deepEqual(await readHistory(journal, account.xpub, cache.server), cache);
  await assert.rejects(writeHistory({ ...journal, writeHead: async () => { throw new Error('locked'); } }, changed), /locked/);
  assert.deepEqual(await readHistory(journal, account.xpub, cache.server), cache);
  await writeHistory(journal, changed);
  assert.equal((await readHistory(journal, account.xpub, cache.server))!.height, 151);
});
test('damaged, oversized, duplicate or wrong-identity cache is discarded for a fresh sync', async () => {
  const { account, cache, journal, files } = setup();
  for (const invalid of [
    { ...cache, version: 2 }, { ...cache, height: -1 },
    { ...cache, addressCounts: { receive: 1001, change: 20 } },
    { ...cache, transactions: [cache.transactions[0], cache.transactions[0]] },
    { ...cache, transactions: [{ ...cache.transactions[0], txid: 'a'.repeat(64) }] },
    { ...cache, transactions: [{ ...cache.transactions[0], height: 151 }] },
  ]) assert.throws(() => decodeHistory(JSON.stringify(invalid), account.xpub, cache.server));
  assert.throws(() => decodeHistory(' '.repeat(MAX_HISTORY_BYTES + 1), account.xpub, cache.server), /too large/);
  await writeHistory(journal, cache);
  files.set((await journal.readHead())!, '{');
  assert.equal(await readHistory(journal, account.xpub, cache.server), null);
});

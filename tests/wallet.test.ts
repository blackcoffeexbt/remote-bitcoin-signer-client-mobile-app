import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { Psbt, Transaction, address, networks } from 'bitcoinjs-lib';
import { fixture } from './fixtures.ts';
import { buildPsbt, broadcastPayment, checkPsbtUnspent, checkUnspent, deriveAddress, estimatedVsize, feeRate, finalizePayment, outpoint, parseGapLimit, planPayment as planForNetwork, recipientScript as scriptForNetwork, sats, syncWallet, transactionKnown, validateCursor, verifyCoin } from '../src/wallet.ts';
import type { Coin } from '../src/wallet.ts';
import type { Rpc } from '../src/electrum.ts';
import { reviewPsbt } from '../src/bitcoin.ts';
import { cacheHistory } from '../src/history-cache.ts';

// Existing adversarial fixtures exercise Testnet4 explicitly.
const planPayment = (...args: Parameters<typeof planForNetwork>) => planForNetwork(args[0], args[1], args[2], args[3], args[4], args[5], 'Testnet4');
const recipientScript = (address: string) => scriptForNetwork(address, 'Testnet4');
function setup() {
  const f = fixture(), a = deriveAddress(f.account, 0, 0);
  const raw = Buffer.from(f.psbt.data.inputs[0].nonWitnessUtxo!).toString('hex');
  const txid = Transaction.fromHex(raw).getId(), row = { tx_hash: txid, tx_pos: 0, value: 100000, height: 1 };
  const coin = verifyCoin(a, row, raw, 150);
  const destination = address.fromOutputScript(f.psbt.txOutputs[0].script, networks.testnet);
  const calls: string[] = [];
  const rpc: Rpc = { request: async (method, params = []) => {
    calls.push(method);
    if (method === 'blockchain.headers.subscribe') return { height: 150 };
    if (method === 'blockchain.scripthash.get_history') return params[0] === a.scripthash ? [{ tx_hash: txid, height: 1 }] : [];
    if (method === 'blockchain.scripthash.listunspent') return params[0] === a.scripthash ? [row] : [];
    if (method === 'blockchain.transaction.get' && params[0] === txid) return raw;
    throw new Error('Electrs: No such mempool or blockchain transaction');
  } };
  return { ...f, a, row, coin, destination, rpc, calls };
}
test('discovers both branches through a gap and verifies coins using full transactions', async () => {
  const f = setup();
  const wallet = await syncWallet(f.rpc, f.account, { receive: 0, change: 0 });
  assert.equal(wallet.coins.length, 1); assert.equal(wallet.coins[0].value, 100000n);
  assert.equal(wallet.addresses.length, 41); assert.deepEqual(wallet.next, { receive: 1, change: 0 });
  assert.equal(wallet.history.length, 1); assert.equal(wallet.coins[0].confirmations, 150);
  assert.equal(wallet.history[0].direction, 'received');
  assert.equal(wallet.history[0].amount, 100000n);
  assert.equal(wallet.history[0].net, 100000n);
  assert.equal(wallet.history[0].fee, null);
  assert.equal(f.calls.includes('blockchain.transaction.broadcast'), false);
});
test('history keeps spent receipts and excludes change and fees from sent payment amounts', async () => {
  const f = setup(), change = deriveAddress(f.account, 1, 0);
  const send = new Transaction();
  send.addInput(Buffer.from(f.coin.txid, 'hex').reverse(), 0);
  send.addOutput(recipientScript(f.destination), 50000n);
  send.addOutput(Buffer.from(change.script, 'hex'), 49000n);
  const move = new Transaction();
  move.addInput(send.getHash(), 1);
  move.addOutput(Buffer.from(f.a.script, 'hex'), 48000n);
  const raws = new Map([[f.coin.txid, f.coin.raw], [send.getId(), send.toHex()], [move.getId(), move.toHex()]]);
  const rpc: Rpc = { request: async (method, params = []) => {
    if (method.endsWith('get_history')) return params[0] === f.a.scripthash || params[0] === change.scripthash
      ? [...raws.keys()].map((tx_hash, index) => ({ tx_hash, height: index === 2 ? 0 : index + 1 })) : [];
    if (method.endsWith('listunspent')) return [];
    if (method === 'blockchain.transaction.get') return raws.get(String(params[0]));
    return f.rpc.request(method, params);
  } };
  const wallet = await syncWallet(rpc, f.account, { receive: 0, change: 0 });
  assert.equal(wallet.history.length, 3);
  const payment = wallet.history.find(tx => tx.txid === send.getId())!;
  assert.equal(payment.direction, 'sent'); assert.equal(payment.amount, 50000n);
  assert.equal(payment.net, -51000n); assert.equal(payment.fee, 1000n);
  assert.deepEqual(payment.outputs.map(output => output.owned), [false, true]);
  assert.equal(payment.outputs[0].address, f.destination);
  assert.equal(wallet.history[0].direction, 'self');
  assert.equal(wallet.history[0].amount, 48000n); assert.equal(wallet.history[0].net, -1000n);
  assert.equal(wallet.history.find(tx => tx.txid === f.coin.txid)!.amount, 100000n);
  // A shared-input transaction must not attribute all recipient outputs or fees
  // to this wallet. It can still report its exact wallet balance change.
  send.addInput(new Uint8Array(32).fill(1), 0);
  raws.delete(payment.txid); raws.delete(move.getId()); raws.set(send.getId(), send.toHex());
  const mixed = (await syncWallet(rpc, f.account, { receive: 0, change: 0 })).history[0];
  assert.equal(mixed.direction, 'mixed'); assert.equal(mixed.amount, -51000n); assert.equal(mixed.fee, null);
  raws.set(send.getId(), f.coin.raw);
  await assert.rejects(syncWallet(rpc, f.account, { receive: 0, change: 0 }), /invalid previous transaction/);
});
test('discovery scans beyond issued addresses even when an early gap is empty', async () => {
  const f = setup();
  const wallet = await syncWallet(f.rpc, f.account, { receive: 25, change: 2 });
  assert.equal(wallet.addresses.filter(a => !a.branch).length, 45);
  assert.equal(wallet.addresses.filter(a => a.branch).length, 22);
  assert.equal(wallet.next.receive, 25);
});
test('configurable gap discovers distant payments on both branches and preserves issued cursors when lowered', async () => {
  const f = setup();
  const receive = deriveAddress(f.account, 0, 30), change = deriveAddress(f.account, 1, 35);
  const tx = new Transaction(); tx.addInput(new Uint8Array(32), 0xffffffff);
  tx.addOutput(Buffer.from(receive.script, 'hex'), 40000n); tx.addOutput(Buffer.from(change.script, 'hex'), 60000n);
  const rpc: Rpc = { request: async (method, params = []) => {
    if (method.endsWith('get_history')) return [receive.scripthash, change.scripthash].includes(String(params[0])) ? [{ tx_hash: tx.getId(), height: 1 }] : [];
    if (method.endsWith('listunspent')) return [];
    if (method === 'blockchain.transaction.get') return tx.toHex();
    return f.rpc.request(method, params);
  } };
  assert.equal((await syncWallet(rpc, f.account, { receive: 0, change: 0 })).history.length, 0);
  const expanded = await syncWallet(rpc, f.account, { receive: 0, change: 0 }, undefined, null, 50);
  assert.deepEqual(expanded.next, { receive: 31, change: 36 });
  assert.equal(expanded.addresses.filter(a => a.branch === 0).length, 81);
  assert.equal(expanded.addresses.filter(a => a.branch === 1).length, 86);
  assert.equal(expanded.history[0].amount, 100000n);
  const lowered = await syncWallet(rpc, f.account, { receive: 80, change: 85 }, undefined, cacheHistory(expanded, 'ssl://example.com:50002'), 20);
  assert.deepEqual(lowered.next, { receive: 80, change: 85 });
  assert.equal(lowered.history[0].amount, 100000n);
  assert.equal(lowered.addresses.filter(a => a.branch === 0).length, 100);
  assert.equal(lowered.addresses.filter(a => a.branch === 1).length, 105);
});
test('gap settings reject invalid values and enforce the total scan bound before RPC', async () => {
  assert.equal(parseGapLimit(' 20 '), 20); assert.equal(parseGapLimit('200'), 200);
  for (const value of ['', '19', '201', '-20', '20.5', '2e2', 'abc']) assert.throws(() => parseGapLimit(value), /gap limit/);
  assert.deepEqual(validateCursor({ receive: 800, change: 800 }, 200), { receive: 800, change: 800 });
  assert.throws(() => validateCursor({ receive: 801, change: 0 }, 200), /scan limit/);
  const f = setup();
  for (const gap of [0, 19, 201, NaN, 20.5]) await assert.rejects(syncWallet(f.rpc, f.account, { receive: 0, change: 0 }, undefined, null, gap), /gap limit/);
  await assert.rejects(syncWallet(f.rpc, f.account, { receive: 950, change: 0 }, undefined, null, 100), /scan limit/);
  assert.equal(f.calls.length, 0);
});
test('refreshes transactions below six cached confirmations and reuses settled raw data', async () => {
  const f = setup();
  let tip = 150, txHeight = 0, gets = 0;
  const rpc: Rpc = { request: async (method, params = []) => {
    if (method === 'blockchain.headers.subscribe') return { height: tip };
    if (method.endsWith('get_history')) return params[0] === f.a.scripthash ? [{ tx_hash: f.coin.txid, height: txHeight }] : [];
    if (method.endsWith('listunspent')) return params[0] === f.a.scripthash ? [{ ...f.row, height: txHeight }] : [];
    if (method === 'blockchain.transaction.get') gets++;
    return f.rpc.request(method, params);
  } };
  for (const h of [-1, 0, 146, 145]) {
    tip = 150; txHeight = h;
    const initial = await syncWallet(rpc, f.account, { receive: 0, change: 0 });
    const cache = cacheHistory(initial, 'ssl://example.com:50002');
    gets = 0; tip = 151;
    const updated = await syncWallet(rpc, f.account, initial.next, undefined, cache);
    assert.equal(gets, h === 145 ? 0 : 1, `cached height ${h}`);
    assert.equal(updated.height, 151); assert.equal(updated.history[0].height, h);
    assert.equal(updated.coins[0].value, 100000n);
  }
  txHeight = 145;
  const initial = await syncWallet(rpc, f.account, { receive: 0, change: 0 });
  const cache = cacheHistory(initial, 'ssl://example.com:50002');
  const incoming = Transaction.fromHex(f.coin.raw); incoming.locktime = 1;
  const newPayment: Rpc = { request: async (method, params = []) => {
    if (method.endsWith('get_history') && params[0] === f.a.scripthash) return [
      { tx_hash: f.coin.txid, height: txHeight }, { tx_hash: incoming.getId(), height: 0 },
    ];
    if (method === 'blockchain.transaction.get' && params[0] === incoming.getId()) return incoming.toHex();
    return rpc.request(method, params);
  } };
  const discovered = await syncWallet(newPayment, f.account, initial.next, undefined, cache);
  assert.equal(discovered.history[0].txid, incoming.getId());
  assert.equal(discovered.history[0].amount, 100000n);
  assert.equal(discovered.history.length, 2, 'new incoming payments are added alongside settled history');
  txHeight = 144; gets = 0;
  await syncWallet(rpc, f.account, initial.next, undefined, cache);
  assert.equal(gets, 1, 'changed confirmation height refreshes even a settled transaction');
  txHeight = 145; tip = 149; gets = 0;
  await syncWallet(rpc, f.account, initial.next, undefined, cache);
  assert.equal(gets, 1, 'chain rollback invalidates settled reuse');
  const missing: Rpc = { request: async (method, params) => method.endsWith('get_history') || method.endsWith('listunspent') ? [] : rpc.request(method, params) };
  const removed = await syncWallet(missing, f.account, initial.next, undefined, cache);
  assert.equal(removed.history.length, 0, 'dropped transactions are removed after a complete refresh');
  await assert.rejects(syncWallet({ request: async () => { throw new Error('offline'); } }, f.account, initial.next, undefined, cache), /offline/);
  assert.equal(cache.transactions.length, 1, 'failed refresh leaves the previous cache intact');
});
test('fails closed on lying amounts, duplicate coins, invalid history and oversized responses', async () => {
  const f = setup();
  for (const kind of ['amount', 'duplicate', 'history', 'size']) {
    const rpc: Rpc = { request: async (m, p) => {
      if (m.endsWith('get_history') && kind === 'history') return [{ tx_hash: 'wrong', height: 0 }];
      if (m.endsWith('listunspent')) {
        if (kind === 'amount') return [{ ...f.row, value: 100001 }];
        if (kind === 'duplicate') return [f.row, f.row];
        if (kind === 'size') return Array(1001).fill(f.row);
      }
      return f.rpc.request(m, p);
    } };
    await assert.rejects(syncWallet(rpc, f.account, { receive: 0, change: 0 }));
  }
});
test('builds, signs, verifies and finalizes a real payment with correct change and fee', () => {
  const f = setup(), plan = planPayment([f.coin], null, f.destination, '50000', '2.125');
  const original = buildPsbt(f.account, plan, deriveAddress(f.account, 1, 0), [f.a]);
  const review = reviewPsbt(original, f.account);
  assert.equal(review.outputs.length, 2); assert.equal(review.outputs[1].change, true);
  assert.equal(BigInt(review.fee), plan.fee);
  const signed = Psbt.fromBase64(original).signAllInputs(f.signer).toBase64();
  const final = finalizePayment(original, signed, f.account);
  assert.ok(final.vsize <= plan.vsize); assert.ok(final.feeRate >= 2.125);
  assert.equal(Transaction.fromHex(final.raw).getId(), final.txid);
  assert.ok(Transaction.fromHex(final.raw).ins[0].witness.length > 0);
});
test('manual selection uses exactly the checked coins; stale, duplicated and excess selections fail', () => {
  const f = setup(), second: Coin = { ...f.coin, txid: 'a'.repeat(64), value: 200000n };
  const plan = planPayment([f.coin, second], [outpoint(f.coin)], f.destination, '50000', '1');
  assert.deepEqual(plan.coins, [f.coin]);
  assert.equal(planPayment([f.coin, second], null, f.destination, '50000', '1').coins[0].txid, second.txid);
  assert.throws(() => planPayment([f.coin], [outpoint(second)], f.destination, '50000', '1'));
  assert.throws(() => planPayment([f.coin], [outpoint(f.coin), outpoint(f.coin)], f.destination, '50000', '1'));
  assert.throws(() => planPayment([f.coin], [], f.destination, '50000', '1'));
  const many = Array.from({ length: 33 }, (_, n) => ({ ...f.coin, txid: n.toString(16).padStart(64, '0') }));
  assert.throws(() => planPayment(many, null, f.destination, 'max', '1'), /32/);
});
test('send max deducts exact estimated fee, and dust change is included in the reviewed fee', () => {
  const f = setup();
  const max = planPayment([f.coin], null, f.destination, 'max', '1.001');
  assert.equal(max.amount + max.fee, f.coin.value); assert.equal(max.change, 0n);
  const noChange = planPayment([f.coin], null, f.destination, '99600', '1');
  assert.equal(noChange.change, 0n); assert.equal(noChange.fee, 400n);
  assert.throws(() => planPayment([f.coin], null, f.destination, '100000', '1'), /Insufficient/);
  assert.throws(() => planPayment([f.coin], null, f.destination, '293', '1'), /dust/);
});
test('excludes immature coinbase and unconfirmed inputs unless explicitly eligible', () => {
  const f = setup();
  assert.throws(() => planPayment([{ ...f.coin, confirmations: 99 }], null, f.destination, '1000', '1'));
  assert.throws(() => planPayment([{ ...f.coin, coinbase: false, confirmations: 0 }], null, f.destination, '1000', '1'));
  assert.ok(planPayment([{ ...f.coin, coinbase: false, confirmations: 0 }], null, f.destination, '1000', '1', true));
});
test('integer satoshi math rejects precision loss and wrong-network / unsupported recipients', () => {
  assert.equal(sats('2100000000000000'), 2100000000000000n);
  for (const value of ['1.1', '1e8', '-1', '0', '2100000000000001']) assert.throws(() => sats(value));
  assert.equal(feeRate('0.001'), 1n); assert.equal(feeRate('1.125'), 1125n);
  for (const value of ['0', '1e3', '1.0001', '10001', 'NaN']) assert.throws(() => feeRate(value));
  assert.throws(() => recipientScript('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'));
  const taproot = address.toBech32(new Uint8Array(32).fill(1), 1, 'tb');
  assert.throws(() => recipientScript(taproot));
  assert.ok(estimatedVsize(32, [new Uint8Array(25), new Uint8Array(22)]) > 2200);
});
test('rechecks spent inputs before preparation and broadcast, including coinbase maturity', async () => {
  const f = setup(); await checkUnspent(f.rpc, [f.coin]); await checkPsbtUnspent(f.rpc, f.unsigned, f.account);
  const spent: Rpc = { request: (m, p) => m.endsWith('listunspent') ? Promise.resolve([]) : f.rpc.request(m, p) };
  await assert.rejects(checkUnspent(spent, [f.coin]), /spent/);
  await assert.rejects(checkPsbtUnspent(spent, f.unsigned, f.account), /spent/);
  const reorg: Rpc = { request: (m, p) => m.endsWith('listunspent') ? Promise.resolve([{ ...f.row, height: 0 }]) : f.rpc.request(m, p) };
  await assert.rejects(checkUnspent(reorg, [f.coin]), /confirmations/);
});
test('explicit broadcast sends only verified transaction bytes and requires matching txid', async () => {
  const f = setup(), final = finalizePayment(f.unsigned, f.signed, f.account), calls: unknown[][] = [];
  const rpc: Rpc = { request: async (m, p) => { calls.push([m, p]); return final.txid; } };
  assert.equal(await broadcastPayment(rpc, f.unsigned, f.signed, f.account), final.txid);
  assert.deepEqual(calls, [['blockchain.transaction.broadcast', [final.raw]]]);
  await assert.rejects(broadcastPayment({ request: async () => 'bad' }, f.unsigned, f.signed, f.account), /uncertain/);
  const bad = Psbt.fromBase64(f.unsigned, { network: networks.testnet }); bad.addOutput({ address: f.destination, value: 1n }); bad.signAllInputs(f.signer);
  // No request is sent for a changed transaction.
  await assert.rejects(broadcastPayment(rpc, f.unsigned, bad.toBase64(), f.account));
  assert.equal(calls.length, 1);
});
test('status lookup distinguishes a missing transaction from network failures', async () => {
  const f = setup();
  assert.equal(await transactionKnown(f.rpc, f.coin.txid), true);
  assert.equal(await transactionKnown(f.rpc, 'a'.repeat(64)), false);
  const missing: Rpc = { request: async (method, params) => {
    assert.equal(method, 'blockchain.transaction.get');
    assert.deepEqual(params, [f.coin.txid, false]);
    throw new Error('Electrs: missing transaction');
  } };
  assert.equal(await transactionKnown(missing, f.coin.txid), false);
  for (const message of ['missing transaction', 'Electrs: internal error', 'Electrs: missing transaction index', 'Electrs connection failed']) {
    const error = new Error(message);
    await assert.rejects(transactionKnown({ request: async () => { throw error; } }, f.coin.txid), e => e === error);
  }
  await assert.rejects(transactionKnown({ request: async () => { throw new Error('timeout'); } }, f.coin.txid), /timeout/);
});

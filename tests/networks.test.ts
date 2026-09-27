import test from 'node:test';
import assert from 'node:assert/strict';
import { address, Psbt, Transaction } from 'bitcoinjs-lib';
import { fixture } from './fixtures.ts';
import { accountNetwork, DEFAULT_NETWORK, NETWORKS } from '../src/networks.ts';
import { receiveAddress, reviewPsbt, validateAccount, verifySignedPsbt } from '../src/bitcoin.ts';
import { buildPsbt, cachedHistory, deriveAddress, finalizePayment, planPayment, recipientScript, verifyCoin } from '../src/wallet.ts';
import { fetchFees } from '../src/fees.ts';

for (const network of ['Mainnet', 'Testnet4'] as const) {
  test(`${network}: derive, construct, review and finalize using the selected BIP84 account`, () => {
    const f = fixture(network), config = NETWORKS[network];
    assert.equal(accountNetwork(validateAccount(f.account)), network);
    assert.ok(f.account.xpub.startsWith(network === 'Mainnet' ? 'xpub' : 'tpub'));
    assert.ok(receiveAddress(f.account).startsWith(network === 'Mainnet' ? 'bc1q' : 'tb1q'));
    const own = deriveAddress(f.account, 0, 0), change = deriveAddress(f.account, 1, 0);
    const previous = Transaction.fromBuffer(f.psbt.data.inputs[0].nonWitnessUtxo!);
    const coin = verifyCoin(own, { tx_hash: previous.getId(), tx_pos: 0, value: 100000, height: 1 }, previous.toHex(), 150);
    const destination = address.fromOutputScript(f.psbt.txOutputs[0].script, config.bitcoin);
    const plan = planPayment([coin], null, destination, '50000', '1', false, network);
    const original = buildPsbt(f.account, plan, change, [own, change]);
    const signed = Psbt.fromBase64(original, { network: config.bitcoin }).signAllInputs(f.signer).toBase64();
    assert.equal(reviewPsbt(original, f.account).outputs[1].change, true);
    const final = finalizePayment(original, signed, f.account);
    assert.equal(final.fee, plan.fee.toString());
    assert.equal(final.txid, Transaction.fromHex(final.raw).getId());
    assert.equal(verifySignedPsbt(original, signed, f.account), signed);
    const history = cachedHistory({ version: 1, xpub: f.account.xpub, server: config.server, height: 150, syncedAt: Date.now(), addressCounts: { receive: 1, change: 1 }, transactions: [{ txid: previous.getId(), height: 1, raw: previous.toHex() }] }, f.account);
    assert.equal(history[0].outputs[0].address, own.address);
    const other = fixture(network === 'Mainnet' ? 'Testnet4' : 'Mainnet');
    assert.throws(() => recipientScript(receiveAddress(other.account), network), /recipient address/);
    assert.throws(() => validateAccount({ ...f.account, path: other.account.path }));
    const wrongPath = Psbt.fromBase64(original, { network: config.bitcoin });
    wrongPath.data.inputs[0].bip32Derivation![0].path = `${other.account.path}/0/0`;
    assert.throws(() => reviewPsbt(wrongPath.toBase64(), f.account), /account path/);
    assert.throws(() => verifySignedPsbt(original, other.signed, f.account));
  });
  test(`${network}: fees use only that network's endpoint`, async () => {
    let url = '';
    await fetchFees(async input => { url = String(input); return new Response(JSON.stringify({ fastestFee: 5, halfHourFee: 4, hourFee: 3, economyFee: 2, minimumFee: 1 })); }, network);
    assert.equal(url, NETWORKS[network].fees);
  });
}
test('fresh installs default to Mainnet; wallet keys differ by network', () => {
  assert.equal(DEFAULT_NETWORK, 'Mainnet');
  assert.notEqual(fixture('Mainnet').account.xpub, fixture('Testnet4').account.xpub);
});

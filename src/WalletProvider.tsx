import { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import type { PublicAccount } from './protocol';
import { ElectrumClient, parseEndpoint } from './electrum';
import { dialElectrum } from './electrum-native';
import { fetchFees } from './fees';
import type { Fees } from './fees';
import { buildPsbt, cachedHistory, checkUnspent, deriveAddress, GAP, parseGapLimit, planPayment, syncWallet, validateCursor } from './wallet';
import type { HistoryCache, HistoryEntry, Plan, Snapshot } from './wallet';
import { loadCursor, loadGapLimit, loadHistory, loadServer, saveCursor, saveGapLimit, saveHistory, saveServer } from './wallet-storage';
import { cacheHistory } from './history-cache';
import { useClient } from './ClientProvider';

type Props = { account: PublicAccount | null; disabled: boolean; paymentPending: boolean; autoRefreshAllowed: boolean; onBusyChange(busy: boolean): void; onPrepared(psbt: string): void; onInvalidate(): void };
function useWalletState({ account, disabled, paymentPending, autoRefreshAllowed, onBusyChange, onPrepared, onInvalidate }: Props) {
  const [server, setServer] = useState(''), [savedServer, setSavedServer] = useState('');
  const [gapLimit, setGapLimit] = useState(GAP), [gapInput, setGapInput] = useState(String(GAP));
  const [settingsReady, setSettingsReady] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [receive, setReceive] = useState('');
  const [stored, setStored] = useState<{ cache: HistoryCache; history: HistoryEntry[] } | null>(null);
  const [cacheFor, setCacheFor] = useState<{ account: PublicAccount; server: string } | null>(null), [historyError, setHistoryError] = useState('');
  const [loadEpoch, setLoadEpoch] = useState(0);
  const refreshed = useRef<{ account: PublicAccount; server: string; epoch: number; gapLimit: number } | null>(null);
  const [destination, setDestination] = useState(''), [amount, setAmount] = useState(''), [maximum, setMaximum] = useState(false);
  const [feeTarget, setFeeTarget] = useState('hourFee');
  const [rate, setRate] = useState(''), [fees, setFees] = useState<Fees | null>(null), [estimated, setEstimated] = useState(false);
  const [manual, setManual] = useState(false), [selected, setSelected] = useState<string[]>([]), [unconfirmed, setUnconfirmed] = useState(false);
  const [busy, setBusy] = useState(false), working = useRef(false), alive = useRef(true), rpc = useRef<ElectrumClient | null>(null);
  const generation = useRef(0);
  const cacheReady = settingsReady && (!account || (cacheFor?.account === account && cacheFor.server === savedServer));
  const lock = disabled || busy || !cacheReady;
  useEffect(() => {
    const lifecycleGeneration = generation;
    let mounted = true;
    alive.current = true;
    void Promise.all([loadServer(), loadGapLimit()]).then(([value, gap]) => { if (mounted) { setServer(value); setSavedServer(value); setGapLimit(gap); setGapInput(String(gap)); setSettingsReady(true); } }).catch(() => { if (mounted) setError('Could not load wallet preferences'); });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { alive.current = false; lifecycleGeneration.current++; rpc.current?.close(); rpc.current = null; working.current = false; setBusy(false); onBusyChange(false); }
      else { alive.current = true; setLoadEpoch(value => value + 1); }
    });
    return () => { mounted = false; alive.current = false; lifecycleGeneration.current++; rpc.current?.close(); subscription.remove(); if (working.current) onBusyChange(false); };
    // Parent callbacks are stable for the lifetime of this keyed account panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!settingsReady || !account) return;
    let mounted = true;
    void loadHistory(account, savedServer).then(cache => {
      if (!mounted) return;
      setStored(cache ? { cache, history: cachedHistory(cache, account) } : null);
    }).catch(() => { if (mounted) setStored(null); })
      .finally(() => { if (mounted) setCacheFor({ account, server: savedServer }); });
    return () => { mounted = false; };
  }, [account, savedServer, settingsReady]);
  const run = async (work: (active: () => boolean) => Promise<void>) => {
    if (!alive.current || working.current || disabled) return;
    const version = ++generation.current;
    const active = () => alive.current && version === generation.current;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try { await work(active); return active(); } catch (e) { if (active()) setError((e as Error).message); }
    finally { if (version === generation.current) { rpc.current?.close(); rpc.current = null; working.current = false; setBusy(false); onBusyChange(false); } }
  };
  const connect = async (active: () => boolean) => {
    if (!savedServer || server.trim() !== savedServer) throw new Error('Save your Electrs server address first');
    const client = new ElectrumClient(); rpc.current = client;
    await client.connect(savedServer, dialElectrum);
    if (!active()) { client.close(); throw new Error('Wallet interrupted'); }
    return client;
  };
  const invalidate = () => { onInvalidate(); setError(''); };
  const updateFees = () => void run(async active => {
    const result = await fetchFees();
    if (!active()) return;
    setFees(result); setStatus('Fees updated.');
    if (!rate || estimated) { setRate(String(result.hourFee)); setFeeTarget('hourFee'); setEstimated(true); invalidate(); }
  });
  const sync = (automatic = false) => account && cacheReady && run(async active => {
    if (!automatic) invalidate();
    setSnapshot(null); setSelected([]); setHistoryError('');
    const c = await connect(active), cursor = await loadCursor(account);
    const cache = stored?.cache.server === savedServer ? stored.cache : null;
    const wallet = await syncWallet(c, account, cursor, text => { if (active()) setStatus(text); }, cache, gapLimit);
    if (!active()) return;
    await saveCursor(account, wallet.next);
    if (!active()) return;
    const updated = cacheHistory(wallet, savedServer);
    setSnapshot(wallet); setStored({ cache: updated, history: wallet.history }); setStatus(`Updated ${new Date(wallet.syncedAt).toLocaleTimeString()}`);
    try { await saveHistory(account, updated); }
    catch { if (active()) setHistoryError('Transactions updated, but could not be stored on this phone. Check free space and refresh again.'); }
  });
  const refreshOnLoad = useEffectEvent(() => { void sync(true); });
  useEffect(() => {
    if (!account || !cacheReady || !savedServer || server.trim() !== savedServer || disabled || busy || !alive.current || !autoRefreshAllowed) return;
    const previous = refreshed.current;
    if (previous?.account === account && previous.server === savedServer && previous.epoch === loadEpoch && previous.gapLimit === gapLimit) return;
    // Mark before starting: busy state changes must not cause a retry loop.
    refreshed.current = { account, server: savedServer, epoch: loadEpoch, gapLimit };
    refreshOnLoad();
  }, [account, cacheReady, savedServer, server, disabled, busy, loadEpoch, gapLimit, autoRefreshAllowed]);
  const saveGapSettings = () => run(async active => {
    const value = parseGapLimit(gapInput);
    if (account) validateCursor(await loadCursor(account), value);
    if (!active()) return;
    await saveGapLimit(value);
    if (active()) {
      setGapLimit(value); setGapInput(String(value));
      if (value !== gapLimit) { setSnapshot(null); setSelected([]); }
      setStatus('Address gap limit saved.');
    }
  });
  const freshAddress = () => account && snapshot && run(async active => {
    const cursor = await loadCursor(account), index = cursor.receive;
    if (index - snapshot.lastUsed.receive > gapLimit) throw new Error('Unused address gap limit reached. Use an existing receive address and refresh, or increase the gap limit in Advanced settings.');
    const a = deriveAddress(account, 0, index);
    await saveCursor(account, validateCursor({ ...cursor, receive: index + 1 }, gapLimit));
    if (active()) setReceive(a.address);
  });
  let plan: Plan | null = null, planError = '';
  if (snapshot && destination && (amount || maximum) && rate) {
    try { plan = planPayment(snapshot.coins, manual ? selected : null, destination, maximum ? 'max' : amount, rate, unconfirmed); }
    catch (e) { planError = (e as Error).message; }
  }
  const prepare = () => account && snapshot && plan && !paymentPending && run(async active => {
    if (Date.now() - snapshot.syncedAt > 300000) throw new Error('Wallet snapshot is over five minutes old. Sync again before preparing a payment.');
    if (estimated && (!fees || Date.now() - fees.fetchedAt > 300000)) throw new Error('Fee estimates are over five minutes old. Refresh or enter a manual rate.');
    const c = await connect(active); await checkUnspent(c, plan.coins);
    const cursor = await loadCursor(account), change = deriveAddress(account, 1, cursor.change);
    const original = buildPsbt(account, plan, change, snapshot.addresses);
    if (!active()) return;
    if (plan.change) {
      if (cursor.change - snapshot.lastUsed.change > gapLimit) throw new Error('Unused address gap limit reached. Complete an existing payment and refresh, or increase the gap limit in Advanced settings.');
      await saveCursor(account, validateCursor({ ...cursor, change: cursor.change + 1 }, gapLimit));
    }
    if (active()) { onPrepared(original); setStatus('Ready to review.'); }
  });
  const saveSettings = () => run(async active => {
    const parsed = parseEndpoint(server.trim()); await saveServer(parsed.url);
    if (active()) { setServer(parsed.url); setSavedServer(parsed.url); setSnapshot(null); setReceive(''); invalidate(); setStatus('Server saved.'); }
  });
  const history = snapshot ?? (stored?.cache.server === savedServer ? { history: stored.history, height: stored.cache.height, syncedAt: stored.cache.syncedAt } : null);
  return { server, setServer, savedServer, gapLimit, gapInput, setGapInput, saveGapSettings, settingsReady, status, error, setError, snapshot, history, historyCached: !snapshot && !!history, historyError, receive, destination, setDestination,
    feeTarget, setFeeTarget, amount, setAmount, maximum, setMaximum, rate, setRate, fees, estimated, setEstimated, manual, setManual, selected, setSelected,
    unconfirmed, setUnconfirmed, busy, lock, invalidate, updateFees, sync, freshAddress, prepare, plan, planError, saveSettings };
}
const Context = createContext<ReturnType<typeof useWalletState> | null>(null);
function Session({ children }: { children: ReactNode }) {
  const c = useClient();
  const value = useWalletState({ account: c.account, disabled: c.busy || c.chainBusy || (!!c.account && c.recovery !== 'ready'),
    paymentPending: !!c.signed, autoRefreshAllowed: (!c.review || !!c.signed) && c.foreground,
    onBusyChange: c.setChainBusy, onPrepared: c.prepare, onInvalidate: c.invalidate });
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const c = useClient();
  return <Session key={c.account?.xpub ?? 'unpaired'}>{children}</Session>;
}
export function useWallet() { const value = useContext(Context); if (!value) throw new Error('Missing wallet session'); return value; }

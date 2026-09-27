# Argus mobile

A **Testnet4-only** wallet client for Android and iOS, built with React Native
and Expo. It connects to an ESP32 remote signer over Nostr. **Bitcoin keys,
transaction signing and approval policy stay on the ESP32.** Broadcasting always
requires a separate confirmation in the app.

## Argus identity and appearance

Argus uses a light teal/ink theme by default. Settings → Appearance offers Light,
Dark and Use system setting; the choice is saved on this phone. The native launch
screen, launcher icon, Wallet header and Settings show the device-and-signal logo.
Theme changes retain wallet, signing and payment state. QR codes remain black on
white in both modes.

The app ID, URL scheme, secure storage keys and `bitcoin-signer` protocol are
retained for update compatibility with existing installations and ESP32 devices.
The local Android build is `artifacts/argus-0.5.4-arm64.apk` (v0.5.4, version code 9).
Settings shows the installed version/build beneath the Argus logo.

## Features

- Wallet, Activity and Settings tabs with shared payment state.
- QR/paste pairing with the ESP32 and authenticated remote wallet-PIN requests.
- Electrs-backed balances, receive addresses, coins and transaction history.
- Payment amounts in recent activity and history; tap for addresses, fee, wallet
  balance change, confirmations and the full transaction ID. Sent amounts exclude
  change and fees; transfers within the wallet are labelled separately.
- Local payment construction, coin control, send-max and Testnet4 fee estimates.
- Verification of device signatures before finalization and broadcast.
- Signed-payment recovery across restarts, plus optional PSBT import/export.

This repository builds independently of both firmware and LNbits. To sign a
payment, you need a provisioned ESP32 running compatible firmware, a reachable
Nostr relay, and a Testnet4 Electrs endpoint. See the local
[protocol](docs/protocol.md) and [delivery specification](docs/mobile-signer-spec.md).

## Quick start

Run commands from this repository's root, alongside `package.json`:

```sh
npm ci
npm run android:device
# Or, on macOS with Xcode and an iPhone:
npm run ios:device
```

These commands build and install a native development app. **Expo Go is not
sufficient** because the wallet uses native TCP/TLS sockets. See [Build and run](#build-and-run)
for platform prerequisites, native project generation and standalone packaging.
For later JavaScript development, use `npm start`.

## Working wallet flow

1. Open ESP32 **Settings → Connect Remote Client**. Scan/paste its QR in the app,
   compare the phone's full Nostr public key on the ESP32 and approve there.
   The independent phone transport key is held in OS-backed secure storage.
2. In **Settings → Wallet server**, save your Testnet4 Electrs Electrum endpoint:
   `ssl://host:50002` for TLS with a system-trusted certificate, or
   `tcp://192.168.1.10:50001` for a trusted local network. Plain TCP exposes
   queries to the network. This field is not an Esplora HTTP API URL. Standard
   Electrs can sit behind a TLS proxy; accept-any-certificate mode is not offered.
3. **Connect wallet**, then **Refresh balance**. The phone verifies
   Testnet4's genesis, scans receive/change branches, and displays balances,
   coins and transaction history. Electrs sees script hashes and supplies chain
   status; this is a server-trusting wallet, not SPV or a full node.
4. Choose **Receive → Create receive address** and copy it to receive Testnet4 coins. Issued
   receive/change indices are persisted per xpub before exposure. Discovery uses
   a 20-address gap and a 1,000-address limit per branch; incomplete scans fail.
5. Enter a recipient and amount in sats, or choose **Send maximum**. Use
   automatic largest-first selection or **Coin control** to select exact outputs.
   Unconfirmed inputs require an explicit opt-in; immature coinbase is excluded.
6. **Get fee estimates** uses only mempool.space's Testnet4 recommended-fee
   endpoint. Choose a target or enter sat/vB manually (up to three decimals).
   Stale estimates require refresh after five minutes. API failures are shown;
   no mainnet fallback is used. Confirmation targets are approximate.
7. **Review payment** checks the selected coins again and builds
   the PSBT locally with full previous transactions and BIP84 derivations. Review
   recipients, verified change, wallet debit and the total fee. Dust remainder
   is explicitly included in the displayed fee. No LNbits service is required.
8. **Approve with device**. Enter the **wallet PIN** only after its
   authenticated request; approve on the device unless its policy permits auto
   approval. All signing, private keys and approval policy stay on the ESP32.
9. The phone verifies every signature against the original transaction/UTXOs,
   finalizes it locally, and shows its txid, actual vsize and fee rate.
   **Send payment** opens a separate confirmation before submitting
   to your Electrs server. Acceptance is not confirmation; sync history to track it.
10. A verified signed-payment recovery record remains on disk until explicitly
    cleared. After restarting, reconnect to the same account to restore it.
    On an uncertain result, **Check payment status** first; retrying broadcasts
    the identical transaction, never automatically creates a replacement.

PSBT file/base64 import and signed PSBT export remain optional tools. No payment
construction, finalization or broadcasting is outsourced to LNbits. v1 firmware
still restricts transactions to Testnet4, native SegWit BIP84 inputs, final
sequences (no RBF), and at most 32 inputs/outputs and a 32 KiB unsigned PSBT.
Full previous transactions can hit that size limit even with fewer inputs.

**Stop waiting / disconnect is local only.** Firmware v1 has no remote cancel,
lock, approve, policy-edit or revoke method. A pending request may still complete
on the ESP32. Backgrounding closes connections and clears PIN/pairing text.
Forgetting the phone connection does not revoke its key on ESP32; use Settings
→ Paired browsers. It also retains account-scoped address cursors and payment
recovery records. A corrupted recovery record blocks new payments until reviewed
and explicitly cleared. PINs, tokens and Bitcoin private keys are never saved.

## Build and run

Node 22.13+, npm, Android Studio / SDK 36 / Java 21, and Xcode 26.4+ for iOS.
The project uses Expo SDK 57 and development builds. Native TCP/TLS support requires a new native build; an older APK cannot run it.

Run these commands from the mobile repository root:

```sh
npm ci
npx expo prebuild
npm run android:device
# or, on the Mac with an iPhone connected:
npm run ios:device
```

For later JavaScript development, `npm start`. Keep the phone and Mac on a
reachable local network. For standalone ARM64 Android testing:

```sh
sh scripts/build-apk.sh
```

The build verifies the packaged app name, version and signature before creating
a versioned APK and checksum. It also refreshes `argus-arm64.apk`, the legacy
`remote-signer-client-arm64.apk` download alias and the local download page so
older client links do not serve stale branding. Historical demo APKs are separate.

The local test APK uses the generated debug certificate, with bundled JavaScript
and no Metro requirement. It is not store-signed. Android 7+ is supported.
Generated `android/` and `ios/` directories are ignored; config plugins preserve
native settings across regeneration.

For iPhone, first regenerate with `npx expo prebuild --platform ios` to install
the new native dependencies, then open the generated `.xcworkspace` under `ios/`.
Select the
`Device`-suffixed scheme, your iPhone and Apple development team, then Run.
The device scheme bundles JavaScript in Release configuration.

If Xcode reports missing `Expo`/`EXConstants` module maps or `No such module
'Expo'`, first close the project window and open `ios/Argus.xcworkspace`.
The workspace includes both Argus and its CocoaPods dependencies; opening
`Argus.xcodeproj` alone can leave those dependencies unbuilt. Select
`ArgusDevice` for the standalone iPhone app. Under the Argus target's
**Signing & Capabilities**, enable automatic signing and select your Apple
development team for both Debug and Release. Then use **Product → Clean Build
Folder** and Run again. Missing-team errors must be resolved separately from
the module-map errors. If the workspace or Pods are missing, run
`npx expo prebuild --platform ios` from the repository root first.

`withActivityLintWorkaround.js` limits a release lint exception to MainActivity's
false `Instantiatable` finding. Its compiled public constructor and full
ReactActivity/AndroidX chain to android.app.Activity were verified during the
previous build. All other release checks remain enabled; recheck on upgrades.

## Architecture and checks

- `src/client.ts`: authenticated Nostr/NIP-44 device requests and PIN binding.
- `src/electrum.ts` / `electrum-native.ts`: bounded Electrum 1.4 JSON-RPC,
  connection/request timeouts and Testnet4 genesis verification over TCP/TLS.
- `src/wallet.ts`: discovery, verified UTXOs, coin selection, fee/PSBT construction,
  signature-checked finalization, spend checks and explicit broadcast operations.
- `src/fees.ts`: bounded, validated mempool.space Testnet4 estimates.
- `src/bitcoin.ts`: original-transaction/UTXO/signature validation.
- `src/wallet-storage.ts`: server/cursor preferences in SecureStore, and a
  public signed-payment recovery file in the app document sandbox (no PIN/seed).
- `src/app/`: Expo Router screens and Wallet/Activity/Settings tabs.
- `src/ClientProvider.tsx` / `WalletProvider.tsx`: shared signing and wallet state.
- `src/screens.tsx` / `BroadcastPanel.tsx`: consumer wallet and approval/send UI.
- `scripts/patch-tcp-tls.cjs`: pinned postinstall fix for Android TCP module TLS
  hostname verification/SNI. Fails closed on unexpected dependency versions.
  Never bypass certificate checks to connect to a self-signed Electrum server.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run export:check
```

Tests use real Bitcoin/Nostr cryptography and deterministic test-only fixtures,
with fake Electrum/relay connections. They cover network mismatches, framed RPC,
bad UTXOs, gap discovery, coinbase maturity, exact coin control, fee rounding,
send-max/dust, spent-input checks, finalization and broadcast binding/errors.
They do not establish native socket interoperability or physical-device behavior.

## Physical acceptance checklist

- Pair/reconnect on Android and iPhone; compare the public account with ESP32.
- Connect to Testnet4 Electrs via TCP and trusted TLS; reject wrong-host, expired,
  untrusted certificates and non-Testnet4 servers. Exercise local-network prompts.
- Receive test coins on a fresh address; restart and ensure indices survive.
- Sync both branches, pending transactions and change; simulate backend failures.
- Select exact UTXOs, exclude immature coinbase, opt into unconfirmed inputs,
  test max-send/insufficient funds/dust, and compare displayed versus final fees.
- Fetch fees, test API failure and five-minute staleness, and use a manual rate.
- Build/sign/reject on ESP32; test wrong PIN, cooldown, timeout and backgrounding.
- Confirm broadcast separately, verify the txid, sync confirmation and restart.
  Drop the broadcast reply; recover/check/retry the exact saved transaction.
- Verify camera/file permissions, signed export and PIN clearing on background.

The iOS native project has been regenerated for v0.3.0, including the local
network permission and `ArgusDevice` scheme. CocoaPods installation
and an iPhone build remain pending. Physical Android/iPhone/ESP32 interoperability
has not been verified.
See [the specification](docs/mobile-signer-spec.md) for bounds and phases.

## Earlier verification record — v0.3 (26 September 2026)

Clean dependency installation, all 37 tests, TypeScript, lint (including App.tsx)
and Android/iOS JavaScript exports passed. The final ARM64 Android build passed;
its APK signature and version 0.3.0 (code 3) were verified. The standalone test
APK is `artifacts/remote-signer-client-arm64.apk`; Android 7+ is required.
No real transaction was broadcast during development. Electrs native socket/TLS,
phone storage/permissions, and the full physical phone-to-ESP32 payment checklist
remain untested. The live mempool.space Testnet4 fee endpoint returned HTTP 503
during the integration check; the app reports this and supports a manual fee rate.

## UI acceptance — v0.4

- Wallet opens with balance, Send/Receive and recent activity. Pairing and
  server forms appear only under Settings. PSBT tools are under Advanced settings.
- Back/tab navigation preserves recipient, amount, selected coins, fee, receive
  address and the prepared payment. A pending payment reopens from Wallet/Activity.
- Receive QR matches the full copy/share address. Long addresses, large amounts,
  accessibility text sizes and the PIN keyboard must remain usable.
- Device PIN is shown only for an authenticated request. Send confirmation remains
  separate from signing. Backgrounding hides content and cancels local waiting,
  without implying that the device or network cancelled a payment.


### UI verification — 26 September 2026

Version 0.4.0 adds Expo Router navigation and shared client/wallet providers.
Clean `npm ci`, 41 tests, TypeScript, lint, and Android/iOS JavaScript exports
passed. Android ARM64 release packaging passed. On the Pixel 9 Pro Android 36
emulator, the app launched and Wallet → Settings → Signing device and back
navigation were checked, including visual inspection of pairing and wallet server
screens. The final APK signature and version 0.4.0 (code 4) were verified.
No React Native or Android app runtime errors were reported in that check.
The emulator briefly showed an Android System UI timeout during startup.
No physical phones, iOS native build, hardware pairing, QR camera scan, or signed
payment navigation/recovery flow was tested for this UI update. Complete the
acceptance and device checklists above before relying on payment flows.

## Repository layout

This directory is the standalone mobile Git repository. Run all commands above
from here. The app does not require either the firmware or LNbits checkout to
build or run. The local `docs/` directory includes the protocol and delivery spec.
In the combined workspace, `../firmware/` and `../lnbits/` are separate repositories.

### Repository split verification — 26 September 2026

After extracting this repository, `npm ci`, all 41 tests, typecheck, lint and
Android/iOS JavaScript exports passed from this directory. No application source
was changed by the split. These checks do not replace the physical acceptance
checklist or establish a successful iOS native build.

### Argus verification — v0.5.0 (26 September 2026)

- Clean `npm ci`, all 41 tests, TypeScript, lint (zero warnings), and Android/iOS
  JavaScript exports passed. Existing upstream Metro package-export warnings remain.
- Local ARM64 Android release build passed. APK signature, package name,
  application label `Argus`, version 0.5.0 / code 5 and ARM64 ABI were verified.
  The local test build uses the generated debug certificate, not a store key.
- Installed over the prior app on the Android emulator without clearing storage.
  Inspected Wallet and Settings branding in light/dark modes. Verified dark mode
  survives force-stop/relaunch and System appearance tracks both light and dark
  system changes. Restored the emulator's original system appearance afterward.
  No React Native/Android runtime errors appeared during these checks.
- Regenerated iOS native Argus naming and splash resources; no iOS native build
  or physical-phone testing was performed. Hardware pairing, signing, native TLS,
  broadcast and recovery interoperability were not exercised for this UI update.
- Public APK downloaded through ngrok and compared byte-for-byte to the signed
  local build. SHA-256: `fefbf1ff169f2e5b75892a76112c793d010281c6c7cedbd45e150ce15678c3ad`.
  The dedicated download directory contains only the APK and checksum.

Local emulator screenshots are in `output/argus/` (ignored by Git).

### Delivery correction — v0.5.1 (26 September 2026)

The legacy download page still linked to a v0.4.0 APK labelled Remote Signer
Client. v0.5.1 (code 6) rebuilds Argus from regenerated native resources and adds
its version/build to Settings. Packaging now verifies the APK label, identity,
version and signature before refreshing the versioned file, current aliases and
legacy download page. It does not alter wallet storage or the app identity.

Clean dependencies, TypeScript, lint, all 41 tests, both JavaScript exports and
Android release packaging passed. Emulator update installation succeeded; Argus
branding, the light theme and Version 0.5.1 / Build 6 were visually verified in
Settings. The certificate matches the previous client. The public APK was compared
byte-for-byte with the local output, and the legacy page's new link was checked.
SHA-256: `44023c6aa126b6c1b81ac91354b3db4714ace439c9dc9663c0c6d781a7ba4337`.
No physical-phone, firmware, signing or broadcast test was performed for this rebuild.

## Payment history amounts — v0.5.2

Recent activity and Activity show received/sent amounts in sats. Sent amounts
exclude wallet change and fees. Tap for output addresses/amounts, wallet balance
change, the known network fee, confirmations/block and the full copyable txid.
Self-transfers and mixed-input wallet changes have distinct labels.

Verification: clean dependency install, 42 tests, typecheck, lint, Android/iOS
exports and local ARM64 release build passed. APK version 0.5.2 (code 7) and
signature verified; the public ngrok download matched the local APK byte-for-byte.
SHA-256: `dc497a4bce6cb5552db1b4c6d386836ab79a536a469ce017dbe2016fdf301b11`.
Physical phone/ESP32 testing was not performed. No transaction was broadcast.


## Local transaction history — v0.5.3

Transaction history is stored per wallet and Electrs server on this phone.
Loading/reconnecting the wallet or returning to the foreground displays saved
activity while refreshing. New transactions and those with fewer than six
confirmations at the previous refresh are fetched again. Transactions with six
or more confirmations reuse verified raw data; changed block heights or a
lower chain tip force a refresh. Address history and unspent status are always
queried, so new payments and dropped transactions are discovered.

Saved activity is labelled with its last update time and stays visible on network
failure. It supplies no spendable coins or balance. Automatic refresh waits for
active signing/review work and never signs, invalidates a prepared payment or
broadcasts. Each cache slot is bounded to 16 MiB, with at most 2,000 transactions;
a damaged cache is rebuilt from the server. Failed cache saves are shown in the
UI and retain the previous complete slot. Recovery journals and address cursors
are separate and retain their existing safeguards.

Verification for v0.5.3: clean dependency install, 46 tests, typecheck, lint,
Android/iOS exports and local ARM64 release build passed. APK version 0.5.3
(code 8) and signature verified; public ngrok download matched byte-for-byte.
SHA-256: `8ee6d8a9322085603a59aaf29598a8ec88fb67e85fadf4fcaeb2db79aba26edc`.
Physical phone/ESP32 testing was not performed. No transaction was broadcast.


## Address gap limit — v0.5.4

Settings → Advanced settings → Address gap limit controls how many consecutive
unused addresses are scanned on both receive and change branches. It defaults
to 20 and accepts whole numbers from 20 to 200. The preference is saved on this
phone and applies across wallets. Larger values can discover payments beyond
the default gap, but refreshes take longer.

Saving a changed limit clears the spendable snapshot and schedules a refresh;
saved activity remains visible. Issued address cursors never move backwards.
Unused receive/change issuance uses the selected gap limit, and the existing
1,000-address-per-branch bound still applies. Values that cannot fit beyond the
current wallet cursor are rejected; discovery never returns a partial balance.

Verification for v0.5.4: clean dependency install, 48 tests, typecheck, lint,
Android/iOS exports and local ARM64 release build passed. APK version 0.5.4
(code 9) and signature verified.
SHA-256: `b4c803bbd6031f1b6f8e72daf003ad5f57d4059d8016ee839666eb490a5c114b`.
Public download verification returned HTTP 403; the user confirmed ngrok's
monthly bandwidth quota is exhausted. Delivery remains local and no verified
public download notification was sent. Physical phone/ESP32 testing was not
performed. No transaction was broadcast.

# Basic Orange Purse

Local-first Bitcoin purse prototype · v0.1.5

Basic Orange Purse is a standalone, local-first Bitcoin purse laboratory,
extracted from the Astro Now project.
This milestone is deliberately **1-of-1**: one encrypted secret stays on the
device, with a portable encrypted recovery export. It is Testnet4-first and is
not yet a production custody system.

## Everyday access and recovery

Each purse has a random vault key which encrypts the seed and purse metadata.
That vault key has two independent encrypted envelopes:

| Purpose | Factor | When it is used |
| --- | --- | --- |
| Everyday unlock | One shared Orange Purse passkey | Normal local unlock for every activated purse on this browser |
| Recovery/export | Recovery passphrase | Creating, importing, or recovering an encrypted export |

The passkey uses the WebAuthn PRF extension to cryptographically unwrap the
vault key; it is not just a UI approval screen. One PRF-capable passkey can
activate any number of purses in the same browser profile, while each purse
uses its own cryptographic salt.

Exports deliberately omit the local passkey envelope. On a new device, recover
once with the passphrase and then activate that device/browser’s shared passkey
for ordinary use.

Existing v0.1.2 purses remain recoverable with their passphrase. Unlock one and
use **Activate shared passkey** in the Vault tab to migrate it to v0.1.3.

Read the fuller [security model](docs/security-model.md) before using this
prototype with anything meaningful.

## What works now

- Create **Testnet4** purses, or an explicitly confirmed **Mainnet** purse.
- Generate a random 32-byte BIP32 master seed locally; its plaintext is never
  stored in IndexedDB or an export file.
- Encrypt the purse payload with TweetNaCl `secretbox` using a random vault key.
- Wrap that vault key with a recovery passphrase derived locally through
  PBKDF2-SHA-256 (600,000 iterations and a random salt).
- Wrap the same vault key with WebAuthn PRF output from a shared passkey for
  passkey-only everyday unlocks.
- Derive native SegWit BIP84 receive addresses locally with `@scure/bip32` and
  `bitcoin-sdk-js`.
- Store encrypted vaults in IndexedDB and export/import encrypted JSON recovery
  files rather than displaying a 12-word phrase.
- Read balances and transactions through the appropriate `mempool.space`
  Testnet4 or Mainnet REST API.
- Send up to 20 native SegWit P2WPKH **Testnet4** recipients in one transaction
  after an explicit review of every destination, confirmed inputs, fee, and
  change, followed by a fresh passkey assertion immediately before local
  signing and broadcast.

## Current sending scope

v0.1.5 supports Testnet4 native-SegWit sending, including batches of up to 20
distinct recipients in one transaction. It uses confirmed UTXOs only,
`bitcoinselect` for conservative local coin selection, a live Testnet4 fee
estimate, spendable change only, an explicit review, and a new passkey PRF
assertion immediately before signing. Mainnet remains receive-only. Do not use
this prototype with meaningful funds.

## Run locally

This is an intentionally simple no-build static ES-module app. Serve it rather
than opening it with `file://`:

```sh
cd basic-orange-purse
python3 -m http.server 4173 --bind localhost
```

Open [http://localhost:4173](http://localhost:4173). Use `localhost` rather
than `127.0.0.1` for passkeys: browsers treat `localhost` as a secure context,
while an IP address commonly fails WebAuthn registration.

## Recovery rehearsal

1. Create a **Testnet4** purse and download its encrypted export.
2. Store the export and recovery passphrase safely for this exercise.
3. Delete the local purse copy from the Vault tab.
4. Import the encrypted export and unlock it once with the passphrase.
5. Activate the shared passkey, then lock and verify it unlocks without asking
   for the passphrase.
6. Confirm the receive address is unchanged.

Complete that rehearsal with Testnet4 funds. Do not use this prototype for
meaningful funds.

## Libraries and APIs

- `@scure/bip32` for local deterministic derivation.
- `bitcoin-sdk-js` for native SegWit address generation and local P2WPKH
  transaction construction/signing.
- TweetNaCl for authenticated encryption.
- WebAuthn PRF for passkey-backed vault-key wrapping.
- `mempool.space` REST API for public blockchain and mempool data, including
  live Testnet4 fee recommendations.

`bitcoinselect` performs local, conservative coin selection for the Testnet4
sender. Its selection is bounded and rechecked against the currently unspent
coins immediately before signing.

## Browser and hosting requirements

Use a current browser and authenticator with WebAuthn PRF support, Web Crypto,
IndexedDB, and JavaScript modules. PRF support varies by browser, OS, and
passkey provider; ordinary passkey support alone is insufficient. Python 3 is
needed only for the example local server. No package install or build is needed.

Keep using the same origin (scheme, host, and port) to access browser storage.
Passkeys are tied to their relying-party domain. Changing hosts requires
recovery from an encrypted export and activating passkey access on the new host.
Serve over HTTPS outside localhost. Never serve personal backups alongside the
app, and never commit purse exports, seeds, passphrases, or credentials.

This app is local-first, but it is **not offline**: it loads JavaScript from
`esm.sh` and queries `mempool.space`. Those providers receive normal network
metadata; the blockchain API also sees queried addresses and broadcast
transactions. Third-party JavaScript executes with the app's origin privileges.
Direct imports are version-pinned; transitive CDN dependencies are not locked
or integrity-verified. Vendoring audited dependencies remains future work.

## Repository checks

With Node.js 22 or later installed:

```sh
npm run check
```

This performs a JavaScript syntax check only; it does not prove cryptographic
correctness or exercise passkeys or transactions. Before proposing a change,
follow [CONTRIBUTING.md](CONTRIBUTING.md) and the
[manual Testnet4 checklist](docs/testing.md).

The local `partial code change - failed to complete/` folder is an unfinished
historical scratch copy. It is excluded from Git and is not part of this project.

## Project status and contributions

This is an unaudited learning prototype, with no production custody guarantee.
Mainnet is receive-only. Recovery, dependency reproducibility, imported-backup
validation, and transaction correctness need further review. Read the
[security model](docs/security-model.md) and [security policy](SECURITY.md).

Bug reports, documentation improvements, and focused pull requests are welcome.
Do not include real wallet material in reports or fixtures.

## Human contribution

The [Human Value Blocks ledger](docs/HUMAN_VALUE_BLOCKS.md) records a provisional
estimate of **10 VBs ≈ 10 human hours · $1,000 of contributed value**, prepared
November 1, 2026, covering the original purse development and standalone open
source preparation. Contributor review is pending. This is recognition of
human effort and a voluntary gift-support baseline; gifts received are separate.

## License

[MIT](LICENSE), copyright 2026 Bob and contributors. Dependencies retain their
own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).

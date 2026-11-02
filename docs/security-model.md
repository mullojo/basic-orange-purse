# Orange Purse security model · v0.1.5

## Scope

Orange Purse is currently a **local-first, 1-of-1 Bitcoin purse laboratory**.
The first intended network is Testnet4. Mainnet exists only as a guarded
prototype choice; it should not hold meaningful funds until the signing,
recovery, and independent review milestones are complete.

The model is designed to be inspectable:

- The encrypted purse is local in IndexedDB.
- The recovery export is portable but encrypted.
- One PRF-capable WebAuthn passkey is the normal cryptographic unlock factor
  for every purse activated in the same browser profile.
- There is no cloud key or cloud backup. The only broadcast path is a bounded,
  native-SegWit Testnet4 flow described below; Mainnet is receive-only.

## Vault structure

At creation, the browser generates a random 32-byte BIP32 master seed and a
separate random 32-byte **vault key**. The seed and minimal purse metadata are
encoded as the payload, then encrypted by TweetNaCl `secretbox`
(XSalsa20-Poly1305) with the vault key and a random 24-byte nonce.

The vault key is stored only in two encrypted envelopes:

1. **Recovery envelope.** The recovery passphrase is processed locally with
   Web Crypto PBKDF2-SHA-256 using a random 16-byte salt and 600,000
   iterations. The resulting 256-bit key encrypts the vault key with another
   random secretbox nonce.
2. **Passkey envelope.** A WebAuthn PRF assertion returns a deterministic
   32-byte secret for the shared Orange Purse credential and a purse-specific
   random 32-byte PRF salt. A context-bound SHA-256 derivation turns that
   output into the key which encrypts the same vault key with a separate
   secretbox nonce.

IndexedDB contains ciphertext, envelopes, salts, nonces, and credential IDs—
not a plaintext seed, vault key, PRF result, or recovery passphrase.

The app clears short-lived derived byte arrays where practical. This is only
best effort: JavaScript and browsers cannot guarantee immediate memory
zeroization. A compromised browser, extension, device, or origin can defeat a
browser-held secret.

## Everyday passkey unlock

The normal v0.1.5 flow is passkey-only:

1. The person approves a WebAuthn assertion with their platform authenticator
   (biometrics, device PIN, or its configured mechanism).
2. The authenticator’s PRF extension returns the per-purse secret.
3. Orange Purse derives the passkey wrapping key, decrypts the vault key, and
   then decrypts the purse payload locally.

One access credential is stored in a separate local IndexedDB access record.
Each purse uses a distinct PRF salt, so the same passkey can unlock multiple
purses without reusing the same wrapping key across them.

This requires a browser and authenticator that support the WebAuthn PRF
extension. `localhost` or HTTPS is required for WebAuthn. If PRF support is
unavailable, the app should not claim a passkey-only vault is protected; use a
compatible platform before relying on this prototype.

## Recovery and portable exports

The recovery passphrase has one narrow job: create, import, and recover a
portable encrypted backup. It is intentionally not requested for routine
unlocking after a passkey envelope is active.

Exports contain the encrypted payload and recovery envelope, but deliberately
exclude the local passkey envelope. This means a copied export plus its
passphrase is recoverable on a new device, while a copied export alone is not.
After importing, the person enters the recovery passphrase once and activates
the shared passkey on that browser for ordinary use.

The strength of recovery still depends heavily on a unique, high-entropy
passphrase and protecting the export separately from that passphrase.

## Migration from v0.1.2

v0.1.2 encrypted the payload directly with the recovery passphrase and used a
passkey only as an interface gate. Those records remain recoverable using their
passphrase. After opening one, **Activate shared passkey** re-encrypts the
payload with a random vault key and writes the two-envelope v0.1.3 format.

Until migration is complete, the old passphrase remains the ordinary unlock
factor for that particular legacy record. Do not delete its only local copy or
backup before verifying the migrated purse unlocks correctly.

## Spending authorization

v0.1.5 sends up to 20 distinct native-SegWit P2WPKH Testnet4 recipients in one
transaction. It uses confirmed UTXOs only, `bitcoinselect` for conservative
local selection, and a visible review of every destination, amount, selected
inputs, fee, and change. A fresh WebAuthn PRF assertion is requested immediately
before local signing and broadcast. Cached unlock state is not treated as
sufficient spending approval. The fresh vault key is compared to the active
vault key and discarded after the attempt.

Mainnet sending is unavailable.

## Relationship to a future 2-of-2 purse

A future 2-of-2 purse is a separate signing and custody protocol. It would use
an independent local signing key and an independent cloud signing key, with a
carefully designed encrypted cloud vault and recovery process. This v0.1.5
model validates local encrypted storage, recovery, passkey-backed access,
address discovery, and transaction visibility before that larger protocol.

## Practical precautions

- Start with Testnet4 and rehearse export → delete → import → passkey activate
  → lock → passkey unlock.
- Use `http://localhost`, not a bare IP address, for WebAuthn testing.
- Protect recovery exports and do not store the recovery passphrase beside one.
- Treat browser storage and browser extensions as part of the threat model.
- Do not rely on this prototype for large Mainnet balances.
- This has not received an independent security audit.

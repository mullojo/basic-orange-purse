# Security policy

Basic Orange Purse v0.1.5 is an unaudited prototype. Use Testnet4 only for
experiments; Mainnet receiving is available but is not a recommendation to
store funds. No release currently has a production security support guarantee.
Read [the security model](docs/security-model.md).

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option when private
vulnerability reporting is enabled. If it is unavailable, open an issue asking
for a private reporting channel, without exploit details or wallet material.
A dedicated private contact has not yet been established. No response-time
commitment is currently offered.

Never post seeds, private keys, recovery passphrases, purse exports, or other
people's wallet data. Use synthetic test fixtures and explain affected flows,
impact, and reproduction steps privately once a channel is established.

## Known review areas

- Remote CDN code runs with access to the app origin; direct version pins do
  not provide a fully reproducible or integrity-verified dependency tree.
- Imported JSON backups require stronger schema, size, KDF-limit, and
  rendering validation. Import only your own trusted test exports.
- JavaScript memory clearing is best effort, and an origin compromise,
  extension, or compromised device can expose unlocked secrets.
- Passkey PRF support and recovery behavior need platform-specific testing.
- Transaction construction, fee estimation, coin selection, change recovery,
  and handling uncertain broadcast outcomes require independent review.

Repository preparation and syntax checks do not constitute a security audit.

# Contributing

Start by reading the README and security model. This is an experimental
Testnet4 project. Keep changes focused and explain the problem, resulting
behavior, and verification in your pull request.

## Local development

Serve the repository with `python3 -m http.server 4173 --bind localhost`, then
open `http://localhost:4173`. There is no build or dependency install step.
Node.js 22+ is optional for `npm run check`, which checks syntax only.

Run the [manual checklist](docs/testing.md) for changes to vaults, recovery,
passkeys, derivation, or sending. Describe your browser/OS and what passed or
could not be tested. Use Testnet4 and disposable test material only.

Preserve existing encrypted-export compatibility or explicitly document a
migration and its recovery checks. Changes to signing, key derivation, network
selection, or cryptography need focused tests and careful review. Do not enable
Mainnet spending as an incidental change.

Never include personal exports, passphrases, private keys, credential IDs, or
real user addresses in issues, screenshots, logs, or test fixtures. See
[SECURITY.md](SECURITY.md) for suspected vulnerabilities.

Contributions are provided under the repository's MIT license. Be respectful
and constructive in reviews.

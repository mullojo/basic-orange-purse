# Third-party dependencies and services

The app imports these packages at runtime from esm.sh:

| Package | Direct version | Source |
| --- | --- | --- |
| tweetnacl | 1.0.3 | https://www.npmjs.com/package/tweetnacl/v/1.0.3 |
| @scure/bip32 | 1.7.0 | https://www.npmjs.com/package/@scure/bip32/v/1.7.0 |
| bitcoin-sdk-js | 1.0.1 | https://www.npmjs.com/package/bitcoin-sdk-js/v/1.0.1 |
| bitcoinselect | 1.0.0 | https://www.npmjs.com/package/bitcoinselect/v/1.0.0 |

These packages and their transitive dependencies remain subject to their own
licenses. No dependency source is vendored here. Inspect package license files
before redistributing a bundled or vendored build. Direct versions do not lock
the CDN's transitive resolution.

mempool.space supplies public blockchain data, fee estimates, address
validation, and Testnet4 transaction broadcast. It can observe queried
addresses, transaction data, and request metadata. Its availability is outside
this project's control. No API credentials are required by the current app.

# Manual Testnet4 checklist

Use disposable test purses and valueless Testnet4 coins. Record the app version,
browser, OS, authenticator, origin, and results in your pull request. These
checks are a contributor checklist, not a record of completed validation.

- [ ] Serve over localhost or HTTPS; confirm the app loads without console errors.
- [ ] Create a Testnet4 purse; activate a PRF-capable passkey.
- [ ] Lock, reload, and unlock with the passkey. Cancel an assertion and verify
      no unlock or broadcast occurs.
- [ ] Export, delete the local test purse, import, recover with the passphrase,
      activate passkey access, and confirm the original receive address.
- [ ] Verify an incorrect recovery passphrase fails without replacing the backup.
- [ ] Create a second purse; confirm shared-passkey access and distinct addresses.
- [ ] Receive Testnet4 coins and check confirmed and unconfirmed activity.
- [ ] Review one send and a multi-recipient batch; verify destinations, amounts,
      selected inputs, fee, and change. Cancel before authorization.
- [ ] With disposable Testnet4 coins, authorize a send, verify its transaction
      in the explorer, and verify change remains recoverable after export/import.
- [ ] Check malformed, wrong-network, duplicate, and more than 20 destinations,
      invalid amounts, insufficient funds, and API failures are handled.
- [ ] Confirm Mainnet sending is rejected. Do not deposit Mainnet funds for testing.
- [ ] Check narrow-screen layout and keyboard navigation.

Run `npm run check` with Node.js 22+. The automated check validates JavaScript
syntax only; it does not contact blockchain services, exercise WebAuthn, or
validate cryptography. Changes to these areas need targeted tests as well as
this checklist.

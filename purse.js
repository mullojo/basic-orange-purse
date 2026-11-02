/**
 * Orange Purse v0.1.5
 *
 * Local-first Testnet4 purse laboratory. A random vault key encrypts each
 * purse payload with TweetNaCl. That vault key has two independent envelopes:
 * a portable recovery-passphrase envelope and a local shared-passkey envelope.
 * The passkey envelope uses WebAuthn PRF output, so normal unlock is
 * cryptographic—not merely a UI gate.
 */
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { HDKey } from "https://esm.sh/@scure/bip32@1.7.0";
import * as bitcoin from "https://esm.sh/bitcoin-sdk-js@1.0.1";
import bitcoinselect from "https://esm.sh/bitcoinselect@1.0.0";

const VERSION = "0.1.5";
const DB_NAME = "orange-purse";
const DB_VERSION = 2;
const VAULT_STORE = "vaults";
const ACCESS_STORE = "access";
const ACCESS_RECORD_ID = "primary";
const VAULT_FORMAT_V1 = "orange-purse-v1";
const VAULT_FORMAT_V2 = "orange-purse-v2";
const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const NETWORKS = {
  testnet4: { label: "Testnet4", api: "https://mempool.space/testnet4/api", explorer: "https://mempool.space/testnet4", bip84: "m/84'/1'/0'/0", sdkNetwork: "testnet" },
  mainnet: { label: "Mainnet", api: "https://mempool.space/api", explorer: "https://mempool.space", bip84: "m/84'/0'/0'/0", sdkNetwork: undefined },
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  pill: $("#network-pill"), setup: $("#setup-card"), create: $("#create-form"), purseName: $("#purse-name"), purseNetwork: $("#purse-network"), createPassphrase: $("#create-passphrase"), createPassphraseConfirm: $("#create-passphrase-confirm"), mainnetConfirmWrap: $("#mainnet-confirm-wrap"), mainnetConfirm: $("#mainnet-confirm"), networkHelp: $("#network-help"), createSubmit: $("#create-submit"),
  unlock: $("#unlock-card"), unlockHeading: $("#unlock-heading"), unlockForm: $("#unlock-form"), unlockPassphrase: $("#unlock-passphrase"), unlockPassphraseStep: $("#unlock-passphrase-step"), unlockPassphraseCopy: $("#unlock-passphrase-copy"), choosePurse: $("#choose-purse"), unlockPasskeyStep: $("#unlock-passkey-step"), approvePasskey: $("#approve-passkey"),
  app: $("#purse-app"), purseSelect: $("#purse-select"), newPurse: $("#new-purse"), lock: $("#lock-purse"), confirmedBalance: $("#confirmed-balance"), mempoolBalance: $("#mempool-balance"), refresh: $("#refresh-chain"), refreshActivity: $("#refresh-activity"), lastRefresh: $("#last-refresh"), currentAddress: $("#current-address"), currentAddressLabel: $("#current-address-label"), newAddress: $("#new-address"), copyAddress: $("#copy-address"), exploreAddress: $("#explore-address"), addressHistory: $("#address-history"), activityEmpty: $("#activity-empty"), transactionList: $("#transaction-list"), sendAddress: $("#send-address"), sendSats: $("#send-sats"), sendFee: $("#send-fee"), reviewSend: $("#review-send"), sendReview: $("#send-review"), batchInput: $("#batch-input"), batchFee: $("#batch-fee"), validateBatch: $("#validate-batch"), batchResult: $("#batch-result"), exportVault: $("#export-vault"), registerPasskey: $("#register-passkey"), passkeyCopy: $("#passkey-copy"), deletePurse: $("#delete-purse"), importDialog: $("#import-dialog"), importForm: $("#import-form"), importFile: $("#import-file"), openImport: $("#open-import"), toast: $("#toast"),
};

const session = { records: [], selectedId: null, unlocked: null, activity: [], balances: { confirmed: 0, mempool: 0 }, pendingSpend: null, broadcasting: false };

function bytesToBase64(bytes) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function bufferFromBase64(value) { const bytes = base64ToBytes(value); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
function hex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : hex(randomBytes(16)); }
function formatSats(value) { return `${Math.abs(Number(value || 0)).toLocaleString()} sats`; }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function isV2(record) { return record?.encrypted?.format === VAULT_FORMAT_V2 && record?.keyEnvelopes?.recovery; }
function networkFor(record = session.unlocked?.record) { return NETWORKS[record?.network || "testnet4"]; }
function notify(message, error = false) { elements.toast.textContent = message; elements.toast.classList.toggle("error", error); elements.toast.classList.add("visible"); clearTimeout(notify.timer); notify.timer = setTimeout(() => elements.toast.classList.remove("visible"), 7200); }
function passkeyErrorMessage(error, action = "unlock") {
  if (error?.name === "NotAllowedError") return `The passkey ${action} was cancelled, timed out, or was temporarily unavailable. Your purse remains safely locked; try again when the authenticator is ready.`;
  if (error?.name === "SecurityError") return "This browser cannot use the stored passkey from this origin. Use the same localhost or HTTPS origin where the passkey was activated.";
  if (error?.name === "InvalidStateError") return "The browser could not use this passkey in its current state. Try again, or recover the purse and activate passkey access again.";
  return error?.message || `Could not ${action} with the passkey.`;
}
function updateNetworkPill(record = session.unlocked?.record) { const network = record?.network; elements.pill.className = `network-pill ${network || ""}`; elements.pill.textContent = network ? `${NETWORKS[network].label} · 1 of 1 local` : "No purse open"; }

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(VAULT_STORE)) database.createObjectStore(VAULT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(ACCESS_STORE)) database.createObjectStore(ACCESS_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}
const vaultDb = { all: () => withStore(VAULT_STORE, "readonly", (store) => store.getAll()), get: (id) => withStore(VAULT_STORE, "readonly", (store) => store.get(id)), put: (record) => withStore(VAULT_STORE, "readwrite", (store) => store.put(record)), delete: (id) => withStore(VAULT_STORE, "readwrite", (store) => store.delete(id)) };
const accessDb = { get: () => withStore(ACCESS_STORE, "readonly", (store) => store.get(ACCESS_RECORD_ID)), put: (record) => withStore(ACCESS_STORE, "readwrite", (store) => store.put(record)) };

async function deriveRecoveryKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, baseKey, 256));
}
async function sha256(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0); const joined = new Uint8Array(total); let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined)); joined.fill(0); return digest;
}
async function derivePasskeyWrapKey(prfOutput, purseSalt) { return sha256(encoder.encode("orange-purse/v0.1.3/passkey-wrap"), prfOutput, purseSalt); }
function encryptBytes(plaintext, key) { const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); return { nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(nacl.secretbox(plaintext, nonce, key)) }; }
function decryptBytes(envelope, key, message = "Could not decrypt this encrypted purse.") { const opened = nacl.secretbox.open(base64ToBytes(envelope.ciphertext), base64ToBytes(envelope.nonce), key); if (!opened) throw new Error(message); return opened; }
async function encryptLegacyPayload(payload, passphrase) { const salt = randomBytes(16); const key = await deriveRecoveryKey(passphrase, salt); const encrypted = encryptBytes(encoder.encode(JSON.stringify(payload)), key); key.fill(0); return { format: VAULT_FORMAT_V1, cipher: "tweetnacl-secretbox", kdf: { name: "PBKDF2-SHA-256", iterations: KDF_ITERATIONS, salt: bytesToBase64(salt) }, ...encrypted }; }
async function decryptLegacyPayload(encrypted, passphrase) { if (encrypted?.format !== VAULT_FORMAT_V1 || encrypted?.cipher !== "tweetnacl-secretbox") throw new Error("This is not an Orange Purse encrypted vault."); const key = await deriveRecoveryKey(passphrase, base64ToBytes(encrypted.kdf.salt), encrypted.kdf.iterations); const opened = decryptBytes(encrypted, key, "That passphrase could not unlock this purse."); key.fill(0); return JSON.parse(new TextDecoder().decode(opened)); }
function encryptPayloadWithVaultKey(payload, vaultKey) { return { format: VAULT_FORMAT_V2, cipher: "tweetnacl-secretbox", ...encryptBytes(encoder.encode(JSON.stringify(payload)), vaultKey) }; }
function decryptPayloadWithVaultKey(encrypted, vaultKey) { if (encrypted?.format !== VAULT_FORMAT_V2) throw new Error("This purse needs recovery before it can be opened here."); return JSON.parse(new TextDecoder().decode(decryptBytes(encrypted, vaultKey, "The passkey could not unlock this purse."))); }
async function makeRecoveryEnvelope(vaultKey, passphrase) { const salt = randomBytes(16); const key = await deriveRecoveryKey(passphrase, salt); const encrypted = encryptBytes(vaultKey, key); key.fill(0); return { kdf: { name: "PBKDF2-SHA-256", iterations: KDF_ITERATIONS, salt: bytesToBase64(salt) }, ...encrypted }; }
async function openRecoveryEnvelope(envelope, passphrase) { const key = await deriveRecoveryKey(passphrase, base64ToBytes(envelope.kdf.salt), envelope.kdf.iterations); const opened = decryptBytes(envelope, key, "That passphrase could not recover this purse."); key.fill(0); return opened; }
async function makePasskeyEnvelope(vaultKey, accessCredential) { const prfSalt = randomBytes(32); const prfOutput = await getPasskeyPrf(accessCredential, prfSalt); const key = await derivePasskeyWrapKey(prfOutput, prfSalt); const encrypted = encryptBytes(vaultKey, key); key.fill(0); prfOutput.fill(0); return { credentialId: accessCredential.credentialId, prfSalt: bytesToBase64(prfSalt), ...encrypted }; }
async function openPasskeyEnvelope(envelope) { const accessCredential = await accessDb.get(); if (!accessCredential || accessCredential.credentialId !== envelope.credentialId) throw new Error("This browser does not have the shared Orange Purse passkey. Recover with your passphrase to activate it here."); const prfSalt = base64ToBytes(envelope.prfSalt); const prfOutput = await getPasskeyPrf(accessCredential, prfSalt); const key = await derivePasskeyWrapKey(prfOutput, prfSalt); const opened = decryptBytes(envelope, key, "This passkey could not unlock the purse."); key.fill(0); prfOutput.fill(0); return opened; }

function blankPayload(seed) { return { seed: bytesToBase64(seed), receive: [], sends: [], createdAt: new Date().toISOString() }; }
function normalizePayload(payload) { payload.receive ??= []; payload.sends ??= []; return payload; }
function requireUnlocked() { if (!session.unlocked) throw new Error("Unlock a purse first."); return session.unlocked; }
async function deriveReceiveAddress(payload, record, index) { const seed = base64ToBytes(payload.seed); try { const root = HDKey.fromMasterSeed(seed); const key = root.derive(`${networkFor(record).bip84}/${index}`); if (!key.publicKey) throw new Error("Unable to derive public key."); const address = await bitcoin.address.generateAddress(hex(key.publicKey), "segwit", networkFor(record).sdkNetwork); return { index, path: `${networkFor(record).bip84}/${index}`, address, createdAt: new Date().toISOString() }; } finally { seed.fill(0); } }
function derivePrivateKey(payload, record, index) { const seed = base64ToBytes(payload.seed); try { const root = HDKey.fromMasterSeed(seed); const key = root.derive(`${networkFor(record).bip84}/${index}`); if (!key.privateKey) throw new Error("Unable to derive this purse's local spending key."); return hex(key.privateKey); } finally { seed.fill(0); } }

function passkeyAvailabilityError() { if (!window.PublicKeyCredential || !navigator.credentials?.get || !navigator.credentials?.create) return "Passkeys are not available in this browser."; if (!window.isSecureContext) return "Passkeys need HTTPS, or http://localhost for local testing. Use localhost rather than 127.0.0.1."; return ""; }
async function getPasskeyPrf(accessCredential, salt) {
  const unavailable = passkeyAvailabilityError(); if (unavailable) throw new Error(unavailable);
  const assertion = await navigator.credentials.get({ publicKey: { challenge: randomBytes(32), allowCredentials: [{ type: "public-key", id: bufferFromBase64(accessCredential.credentialId) }], userVerification: "required", timeout: 60_000, extensions: { prf: { eval: { first: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) } } } } });
  const output = assertion.getClientExtensionResults?.()?.prf?.results?.first;
  if (!output) throw new Error("This passkey does not support the PRF extension required for passkey-only vault access. Use recovery, then create a supported passkey.");
  return new Uint8Array(output);
}
async function ensureSharedAccessPasskey(displayName = "Orange Purse") {
  const saved = await accessDb.get(); if (saved) return saved;
  const unavailable = passkeyAvailabilityError(); if (unavailable) throw new Error(unavailable);
  const credential = await navigator.credentials.create({ publicKey: { challenge: randomBytes(32), rp: { name: "Orange Purse" }, user: { id: randomBytes(32), name: "orange-purse-access", displayName }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { residentKey: "preferred", userVerification: "required" }, timeout: 60_000, extensions: { prf: { eval: { first: randomBytes(32).buffer } } } } });
  if (!credential) throw new Error("Passkey registration was cancelled.");
  const candidate = { id: ACCESS_RECORD_ID, credentialId: bytesToBase64(new Uint8Array(credential.rawId)), origin: location.origin, createdAt: new Date().toISOString(), prf: true };
  // Verify that this specific credential can actually return PRF material.
  const probe = randomBytes(32); const output = await getPasskeyPrf(candidate, probe); output.fill(0);
  await accessDb.put(candidate); return candidate;
}

async function saveUnlockedPayload() {
  const { record, payload, vaultKey, legacyPassphrase } = requireUnlocked();
  record.encrypted = isV2(record) ? encryptPayloadWithVaultKey(payload, vaultKey) : await encryptLegacyPayload(payload, legacyPassphrase);
  record.updatedAt = new Date().toISOString(); await vaultDb.put(record); session.records = await vaultDb.all(); renderPurseSelect();
}

async function createPurse({ name, network, passphrase }) {
  const seed = randomBytes(32); const vaultKey = randomBytes(nacl.secretbox.keyLength);
  try {
    const payload = blankPayload(seed); const record = { id: uuid(), name, network, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), encrypted: null, keyEnvelopes: {} };
    payload.receive.push(await deriveReceiveAddress(payload, record, 0));
    const accessCredential = await ensureSharedAccessPasskey(name);
    record.encrypted = encryptPayloadWithVaultKey(payload, vaultKey);
    record.keyEnvelopes = { recovery: await makeRecoveryEnvelope(vaultKey, passphrase), passkey: await makePasskeyEnvelope(vaultKey, accessCredential) };
    await vaultDb.put(record); session.records = await vaultDb.all(); session.selectedId = record.id; session.unlocked = { record, payload, vaultKey }; session.activity = []; session.balances = { confirmed: 0, mempool: 0 }; showUnlockedPurse();
    notify(`${NETWORKS[network].label} purse created. Your shared passkey now unlocks this and future purses.`);
  } finally { seed.fill(0); }
}

function renderPurseSelect() { elements.purseSelect.innerHTML = session.records.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map((record) => `<option value="${record.id}">${escapeHtml(record.name)} · ${NETWORKS[record.network].label}</option>`).join(""); if (session.selectedId) elements.purseSelect.value = session.selectedId; }
function showSetup() { lockPurse(); elements.setup.hidden = false; elements.unlock.hidden = true; elements.app.hidden = true; elements.purseName.focus(); }
function showUnlock(record) { lockPurse(); session.selectedId = record.id; elements.setup.hidden = true; elements.app.hidden = true; elements.unlock.hidden = false; elements.unlockHeading.textContent = `Unlock ${record.name}`; elements.unlockPassphrase.value = ""; renderUnlockRequirements(record); updateNetworkPill(record); }
function renderUnlockRequirements(record) {
  const passkeyPrimary = isV2(record) && record.keyEnvelopes?.passkey;
  elements.unlockPasskeyStep.hidden = !passkeyPrimary; elements.unlockForm.hidden = Boolean(passkeyPrimary);
  elements.unlockPassphraseStep.textContent = isV2(record) ? "Recovery only" : "Legacy recovery";
  elements.unlockPassphraseCopy.textContent = isV2(record) ? "Use this only to recover an exported purse or activate passkey-only access in this browser." : "This older purse uses a recovery passphrase. After opening it, migrate it to passkey-only access.";
  elements.approvePasskey.textContent = "Unlock with passkey";
  setTimeout(() => (passkeyPrimary ? elements.approvePasskey : elements.unlockPassphrase).focus(), 0);
}
function showUnlockedPurse() { elements.setup.hidden = true; elements.unlock.hidden = true; elements.app.hidden = false; updateNetworkPill(); renderPurseSelect(); renderPurse(); }
function lockPurse() { if (session.unlocked?.vaultKey) session.unlocked.vaultKey.fill(0); session.unlocked = null; session.activity = []; session.balances = { confirmed: 0, mempool: 0 }; session.pendingSpend = null; session.broadcasting = false; updateNetworkPill(); }
function selectedRecord() { return session.records.find((record) => record.id === session.selectedId); }

function renderPurse() {
  const { payload, record } = requireUnlocked(); const addresses = payload.receive || []; const current = addresses.at(-1);
  elements.currentAddress.textContent = current?.address || "No receiving address"; elements.currentAddressLabel.textContent = current ? `Address #${current.index} · ${current.path}` : "No address"; elements.exploreAddress.href = current ? `${networkFor(record).explorer}/address/${current.address}` : "#"; elements.confirmedBalance.textContent = formatSats(session.balances.confirmed); elements.mempoolBalance.textContent = `${formatSats(session.balances.mempool)} pending`; elements.lastRefresh.textContent = session.lastRefresh ? `Checked ${formatDate(session.lastRefresh)}` : "Not checked yet";
  elements.addressHistory.innerHTML = addresses.slice().reverse().map((item) => `<div class="address-item ${item.address === current?.address ? "current" : ""}"><div><strong>#${item.index}</strong> <code title="${item.address}">${item.address}</code></div><button type="button" data-select-address="${item.index}">Use</button></div>`).join("");
  elements.addressHistory.querySelectorAll("[data-select-address]").forEach((button) => button.addEventListener("click", () => useAddress(Number(button.dataset.selectAddress))));
  const passkeyReady = Boolean(record.keyEnvelopes?.passkey); elements.registerPasskey.textContent = passkeyReady ? "Shared passkey active" : (!isV2(record) ? "Migrate to shared passkey" : "Activate shared passkey"); elements.registerPasskey.disabled = passkeyReady; elements.passkeyCopy.textContent = passkeyReady ? "Your shared passkey cryptographically unlocks this purse and any future purse on this browser. The recovery passphrase remains for export and recovery only." : "This recovered or legacy purse still needs passkey-only access activated. Your recovery passphrase will not be used for everyday unlocks afterward.";
  renderActivity();
}
function useAddress(index) { const { payload } = requireUnlocked(); const indexInArray = payload.receive.findIndex((address) => address.index === index); if (indexInArray < 0) return; const [selected] = payload.receive.splice(indexInArray, 1); payload.receive.push(selected); saveUnlockedPayload().then(renderPurse).catch((error) => notify(error.message, true)); }
function transactionDirection(transaction, addresses) { const mine = new Set(addresses.map((item) => item.address)); const received = transaction.vout.reduce((sum, output) => mine.has(output.scriptpubkey_address) ? sum + Number(output.value || 0) : sum, 0); const sent = transaction.vin.reduce((sum, input) => mine.has(input.prevout?.scriptpubkey_address) ? sum + Number(input.prevout?.value || 0) : sum, 0); if (received && sent) return { label: "Moved", value: received - sent }; if (received) return { label: "Received", value: received }; return { label: "Sent", value: -sent }; }
function renderActivity() { const addresses = session.unlocked?.payload?.receive || []; elements.activityEmpty.hidden = session.activity.length > 0; elements.transactionList.innerHTML = session.activity.map((transaction) => { const direction = transactionDirection(transaction, addresses); const confirmed = transaction.status?.confirmed; const time = confirmed && transaction.status?.block_time ? formatDate(transaction.status.block_time * 1000) : "Awaiting confirmation"; const sign = direction.value >= 0 ? "+" : "−"; return `<article class="tx-row"><div><strong>${direction.label} · ${confirmed ? "confirmed" : "mempool"}</strong><p>${time} · <a href="${networkFor().explorer}/tx/${transaction.txid}" target="_blank" rel="noopener">${transaction.txid.slice(0, 12)}…</a></p></div><div class="tx-value">${sign}${formatSats(direction.value)}</div></article>`; }).join(""); }
async function requestJson(path, options) { const response = await fetch(`${networkFor().api}${path}`, options); if (!response.ok) throw new Error(`Network request failed (${response.status}).`); return response.json(); }
async function requestText(path, options) { const response = await fetch(`${networkFor().api}${path}`, options); const body = await response.text(); if (!response.ok) throw new Error(body || `Network request failed (${response.status}).`); return body; }
async function refreshChain() { const { payload } = requireUnlocked(); const addresses = payload.receive || []; if (!addresses.length) return; elements.refresh.disabled = true; elements.refreshActivity.disabled = true; elements.refresh.textContent = "Checking…"; try { const results = await Promise.all(addresses.map(async ({ address }) => ({ info: await requestJson(`/address/${encodeURIComponent(address)}`), transactions: await requestJson(`/address/${encodeURIComponent(address)}/txs`) }))); const uniqueTransactions = new Map(); let confirmed = 0; let mempool = 0; for (const result of results) { confirmed += Number(result.info.chain_stats.funded_txo_sum || 0) - Number(result.info.chain_stats.spent_txo_sum || 0); mempool += Number(result.info.mempool_stats.funded_txo_sum || 0) - Number(result.info.mempool_stats.spent_txo_sum || 0); for (const transaction of result.transactions) uniqueTransactions.set(transaction.txid, transaction); } session.balances = { confirmed, mempool }; session.activity = Array.from(uniqueTransactions.values()).sort((a, b) => (b.status?.block_time || 0) - (a.status?.block_time || 0)); session.lastRefresh = Date.now(); renderPurse(); notify(`Checked ${addresses.length} ${addresses.length === 1 ? "address" : "addresses"} on ${networkFor().label}.`); } catch (error) { notify(error.message || "The network check was unavailable.", true); } finally { elements.refresh.disabled = false; elements.refreshActivity.disabled = false; elements.refresh.textContent = "↻ Refresh chain"; } }
async function createNextAddress() { const { payload, record } = requireUnlocked(); const nextIndex = Math.max(-1, ...payload.receive.map((item) => item.index)) + 1; elements.newAddress.disabled = true; elements.newAddress.textContent = "Deriving…"; try { payload.receive.push(await deriveReceiveAddress(payload, record, nextIndex)); await saveUnlockedPayload(); renderPurse(); notify(`Address #${nextIndex} is ready to receive.`); } catch (error) { notify(error.message || "Could not derive a new address.", true); } finally { elements.newAddress.disabled = false; elements.newAddress.textContent = "New address"; } }
async function copyCurrentAddress() { const address = requireUnlocked().payload.receive.at(-1)?.address; if (!address) return; try { await navigator.clipboard.writeText(address); notify("Receive address copied."); } catch { notify("Your browser did not allow clipboard access.", true); } }
function parseBatchLines(value) { return value.split(/\r?\n/).map((line, index) => ({ line: line.trim(), row: index + 1 })).filter((item) => item.line); }
async function validateBatch() { const lines = parseBatchLines(elements.batchInput.value); if (!lines.length) return notify("Add at least one address and sat amount first.", true); elements.validateBatch.disabled = true; elements.validateBatch.textContent = "Validating…"; try { const results = await Promise.all(lines.map(async ({ line, row }) => { const [rawAddress = "", rawSats = ""] = line.split(",").map((part) => part.trim()); const sats = Number(rawSats.replace(/_/g, "")); if (!Number.isSafeInteger(sats) || sats <= 0) return { row, address: rawAddress, sats, valid: false, message: "Use a positive whole sat value." }; try { const validation = await requestJson(`/v1/validate-address/${encodeURIComponent(rawAddress)}`); const expectedTestnet = networkFor().sdkNetwork === "testnet"; const addressIsTestnet = /^(tb1|m|n|2)/i.test(rawAddress); const networkMatches = expectedTestnet === addressIsTestnet; return { row, address: rawAddress, sats, valid: Boolean(validation.isvalid && networkMatches), message: networkMatches ? "Ready for signing stage" : `Wrong network for ${networkFor().label}` }; } catch { return { row, address: rawAddress, sats, valid: false, message: "Address validation unavailable" }; } })); const total = results.filter((item) => item.valid).reduce((sum, item) => sum + item.sats, 0); elements.batchResult.innerHTML = `<p class="batch-summary">${results.filter((item) => item.valid).length}/${results.length} destination${results.length === 1 ? "" : "s"} ready · ${formatSats(total)} planned</p>` + results.map((item) => `<div class="batch-line ${item.valid ? "valid" : "invalid"}"><strong>Line ${item.row}</strong> · ${escapeHtml(item.address || "No address")} · ${item.sats ? formatSats(item.sats) : "no amount"}<br><small>${item.message}</small></div>`).join(""); } finally { elements.validateBatch.disabled = false; elements.validateBatch.textContent = "Validate destinations"; } }

// Testnet4 P2WPKH sends use bitcoinselect for coin selection. Mainnet and
// non-P2WPKH destinations remain deliberately outside this prototype.
const P2WPKH_DUST = 330;
function isTestnetP2wpkh(address) { return /^tb1q[ac-hj-np-z02-9]{38}$/i.test(address); }
function transactionVbytes(inputCount, outputCount) { return Math.ceil(10.5 + (68 * inputCount) + (31 * outputCount)); }
async function validateDestination(address) {
  const clean = String(address || "").trim();
  if (!isTestnetP2wpkh(clean)) throw new Error("Use a native SegWit Testnet4 address (tb1q…, 42 characters).");
  const validation = await requestJson(`/v1/validate-address/${encodeURIComponent(clean)}`);
  if (!validation.isvalid) throw new Error("That destination address is not valid.");
  return clean;
}
async function loadConfirmedUtxos(payload) {
  const groups = await Promise.all((payload.receive || []).map(async (entry) => {
    const utxos = await requestJson(`/address/${encodeURIComponent(entry.address)}/utxo`);
    return utxos.filter((utxo) => utxo.status?.confirmed).map((utxo) => ({ txId: utxo.txid, vout: Number(utxo.vout), value: Number(utxo.value), derivationIndex: entry.index, address: entry.address }));
  }));
  return groups.flat().filter((utxo) => /^[a-f0-9]{64}$/i.test(utxo.txId) && Number.isSafeInteger(utxo.vout) && utxo.vout >= 0 && Number.isSafeInteger(utxo.value) && utxo.value > 0);
}
async function getTestnetFeeRate(preference) {
  const fees = await requestJson("/v1/fees/recommended");
  const candidates = { economy: fees.economyFee || fees.hourFee, normal: fees.hourFee || fees.halfHourFee, priority: fees.fastestFee || fees.halfHourFee };
  const feeRate = Math.ceil(Number(candidates[preference] || candidates.normal));
  if (!Number.isSafeInteger(feeRate) || feeRate < 1 || feeRate > 100) throw new Error("The Testnet4 fee estimate was outside Orange Purse's safe review range. Try again later.");
  return feeRate;
}
async function buildSpendPlan(rawRecipients, preference) {
  const { record, payload } = requireUnlocked();
  if (record.network !== "testnet4") throw new Error("Sending is enabled only for Testnet4 in v0.1.5. Mainnet remains receive-only.");
  if (!Array.isArray(rawRecipients) || !rawRecipients.length || rawRecipients.length > 20) throw new Error("Enter between 1 and 20 destinations.");
  const recipients = await Promise.all(rawRecipients.map(async ({ address, value }, index) => {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Destination ${index + 1} needs a positive whole number of sats.`);
    return { address: await validateDestination(address), value: amount };
  }));
  if (new Set(recipients.map((recipient) => recipient.address)).size !== recipients.length) throw new Error("Each destination address may appear only once in a batch.");
  const [utxos, feeRate] = await Promise.all([loadConfirmedUtxos(payload), getTestnetFeeRate(preference)]);
  if (!utxos.length) throw new Error("No confirmed coins are available to spend yet.");
  // bitcoinselect's input model is intentionally conservative for our native
  // SegWit inputs. Requesting 2× the live floor keeps the resulting signed
  // transaction from falling below the reviewed fee preference.
  const selection = bitcoinselect(utxos, recipients, feeRate * 2);
  if (!selection?.inputs?.length || !selection?.outputs?.length) throw new Error("The confirmed balance cannot cover these destinations and the network fee.");
  const inputs = selection.inputs.map((input) => utxos.find((utxo) => utxo.txId === input.txId && utxo.vout === Number(input.vout) && utxo.value === Number(input.value))).filter(Boolean);
  if (inputs.length !== selection.inputs.length) throw new Error("Coin selection returned an unknown purse input.");
  const changeOutput = selection.outputs.find((output) => !output.address);
  const changeValue = Number(changeOutput?.value || 0);
  if (!Number.isSafeInteger(changeValue) || changeValue < 0 || (changeValue && changeValue < P2WPKH_DUST)) throw new Error("Coin selection produced an unsafe change amount.");
  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0);
  const sentSats = recipients.reduce((sum, recipient) => sum + recipient.value, 0);
  const fee = totalInput - sentSats - changeValue;
  const outputCount = recipients.length + (changeValue ? 1 : 0);
  const vbytes = transactionVbytes(inputs.length, outputCount);
  const effectiveFeeRate = Math.ceil(fee / vbytes);
  if (inputs.length > 100 || vbytes > 10_000 || !Number.isSafeInteger(fee) || fee < Math.ceil(feeRate * vbytes) || fee > Math.ceil(feeRate * vbytes * 4)) throw new Error("Coin selection produced a transaction outside Orange Purse's safe review range.");
  const changeIndex = changeValue ? Math.max(-1, ...payload.receive.map((entry) => entry.index)) + 1 : null;
  const change = changeValue ? { ...await deriveReceiveAddress(payload, record, changeIndex), value: changeValue, purpose: "change" } : null;
  return { recipients, inputs, fee, feeRate, effectiveFeeRate, vbytes, sentSats, change, preference, createdAt: new Date().toISOString() };
}
function clearPendingSpend() { session.pendingSpend = null; elements.sendReview.innerHTML = ""; elements.batchResult.innerHTML = ""; }
function renderSpendReview(plan, source) {
  const rows = plan.recipients.map((recipient) => `<li><code>${escapeHtml(recipient.address)}</code><strong>${formatSats(recipient.value)}</strong></li>`).join("");
  const target = source === "batch" ? elements.batchResult : elements.sendReview;
  target.innerHTML = `<section class="spend-review-card"><p class="eyebrow">Testnet4 transaction review</p><h3>${source === "batch" ? `${plan.recipients.length} destinations` : "One destination"}</h3><ul class="recipient-review">${rows}</ul><dl class="spend-totals"><div><dt>Send total</dt><dd>${formatSats(plan.sentSats)}</dd></div><div><dt>Network fee</dt><dd>${formatSats(plan.fee)} · ${plan.effectiveFeeRate} sat/vB · ${plan.vbytes} vB</dd></div><div><dt>Inputs</dt><dd>${plan.inputs.length} confirmed coin${plan.inputs.length === 1 ? "" : "s"}</dd></div>${plan.change ? `<div><dt>Change</dt><dd>${formatSats(plan.change.value)} to new address #${plan.change.index}</dd></div>` : ""}</dl><p class="tip">A fresh passkey assertion is required immediately before local signing. This action broadcasts to Testnet4.</p><div class="actions"><button class="button primary" type="button" id="authorize-spend">Authorize & broadcast Testnet4</button><button class="button quiet" type="button" id="cancel-spend">Cancel</button></div></section>`;
  $("#authorize-spend").addEventListener("click", authorizeSpend);
  $("#cancel-spend").addEventListener("click", clearPendingSpend);
}
async function reviewSingleSend() {
  if (session.broadcasting) return;
  elements.reviewSend.disabled = true; elements.reviewSend.textContent = "Preparing review…";
  try { clearPendingSpend(); session.pendingSpend = { ...await buildSpendPlan([{ address: elements.sendAddress.value, value: elements.sendSats.value }], elements.sendFee.value), source: "single" }; renderSpendReview(session.pendingSpend, "single"); }
  catch (error) { notify(error.message || "Could not prepare this Testnet4 send.", true); }
  finally { elements.reviewSend.disabled = false; elements.reviewSend.textContent = "Review Testnet4 transaction"; }
}
async function reviewBatchSend() {
  if (session.broadcasting) return;
  const lines = parseBatchLines(elements.batchInput.value);
  if (!lines.length) return notify("Add at least one address and sat amount first.", true);
  elements.validateBatch.disabled = true; elements.validateBatch.textContent = "Preparing review…";
  try {
    const recipients = lines.map(({ line, row }) => {
      const parts = line.split(",").map((part) => part.trim());
      if (parts.length !== 2) throw new Error(`Line ${row} must use exactly: address, sats.`);
      return { address: parts[0], value: Number(parts[1].replace(/_/g, "")) };
    });
    clearPendingSpend(); session.pendingSpend = { ...await buildSpendPlan(recipients, elements.batchFee.value), source: "batch" }; renderSpendReview(session.pendingSpend, "batch");
  } catch (error) { notify(error.message || "Could not prepare this Testnet4 batch.", true); }
  finally { elements.validateBatch.disabled = false; elements.validateBatch.textContent = "Review Testnet4 batch"; }
}
async function selectedCoinsAreStillUnspent(plan, payload) {
  const current = await loadConfirmedUtxos(payload);
  const available = new Set(current.map((utxo) => `${utxo.txId}:${utxo.vout}:${utxo.value}`));
  return plan.inputs.every((utxo) => available.has(`${utxo.txId}:${utxo.vout}:${utxo.value}`));
}
async function authorizeSpend() {
  const plan = session.pendingSpend;
  if (!plan || session.broadcasting) return;
  const { record, payload, vaultKey } = requireUnlocked();
  if (record.network !== "testnet4" || !record.keyEnvelopes?.passkey) return notify("A Testnet4 purse with an active shared passkey is required to send.", true);
  session.broadcasting = true;
  const button = $("#authorize-spend"); if (button) { button.disabled = true; button.textContent = "Confirming passkey…"; }
  let freshVaultKey;
  try {
    freshVaultKey = await openPasskeyEnvelope(record.keyEnvelopes.passkey);
    if (freshVaultKey.length !== vaultKey.length || !freshVaultKey.every((byte, index) => byte === vaultKey[index])) throw new Error("This passkey does not unlock the active purse.");
    if (!await selectedCoinsAreStillUnspent(plan, payload)) throw new Error("One of the selected coins is no longer confirmed and unspent. Review the transaction again.");
    if (plan.change && !payload.receive.some((entry) => entry.address === plan.change.address)) { payload.receive.push(plan.change); await saveUnlockedPayload(); }
    const transaction = new bitcoin.Transaction();
    for (const input of plan.inputs) await transaction.addInput({ txHash: input.txId, index: input.vout, value: input.value });
    for (const recipient of plan.recipients) await transaction.addOutput({ address: recipient.address, value: recipient.value });
    if (plan.change) await transaction.addOutput({ address: plan.change.address, value: plan.change.value });
    for (let index = 0; index < plan.inputs.length; index += 1) await transaction.signInput(derivePrivateKey(payload, record, plan.inputs[index].derivationIndex), index);
    const signedHex = await transaction.getSignedHex();
    if (!/^[a-f0-9]+$/i.test(signedHex)) throw new Error("Local signing did not produce a valid transaction.");
    const txid = (await requestText("/tx", { method: "POST", headers: { "Content-Type": "text/plain" }, body: signedHex })).trim();
    if (!/^[a-f0-9]{64}$/i.test(txid)) throw new Error("The Testnet4 server did not return a transaction ID.");
    payload.sends.push({ txid, recipients: plan.recipients, sentSats: plan.sentSats, fee: plan.fee, feeRate: plan.effectiveFeeRate, broadcastAt: new Date().toISOString(), network: "testnet4" });
    await saveUnlockedPayload(); const source = plan.source; clearPendingSpend(); if (source === "single") { elements.sendAddress.value = ""; elements.sendSats.value = ""; } else elements.batchInput.value = ""; await refreshChain(); notify(`Broadcast Testnet4 transaction ${txid.slice(0, 12)}…`);
  } catch (error) { notify(error?.name === "NotAllowedError" ? passkeyErrorMessage(error, "authorization") : (error.message || "The transaction could not be completed. Check Testnet4 activity before trying again."), true); }
  finally { freshVaultKey?.fill(0); session.broadcasting = false; const current = $("#authorize-spend"); if (current) { current.disabled = false; current.textContent = "Authorize & broadcast Testnet4"; } }
}

async function exportVault() { const { record } = requireUnlocked(); const portableRecord = JSON.parse(JSON.stringify(record)); if (portableRecord.keyEnvelopes) portableRecord.keyEnvelopes.passkey = null; delete portableRecord.passkey; const exported = { exportFormat: isV2(record) ? VAULT_FORMAT_V2 : VAULT_FORMAT_V1, exportedAt: new Date().toISOString(), purse: portableRecord }; const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${record.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "orange-purse"}-${record.network}.orange-purse.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify("Encrypted purse backup downloaded. It needs your recovery passphrase on another device."); }
async function activatePasskeyForPurse() { const { record, payload, vaultKey, legacyPassphrase } = requireUnlocked(); try { const accessCredential = await ensureSharedAccessPasskey(record.name); if (!isV2(record)) { const newVaultKey = randomBytes(nacl.secretbox.keyLength); record.encrypted = encryptPayloadWithVaultKey(payload, newVaultKey); record.keyEnvelopes = { recovery: await makeRecoveryEnvelope(newVaultKey, legacyPassphrase), passkey: await makePasskeyEnvelope(newVaultKey, accessCredential) }; vaultKey?.fill(0); session.unlocked.vaultKey = newVaultKey; delete session.unlocked.legacyPassphrase; } else { record.keyEnvelopes.passkey = await makePasskeyEnvelope(vaultKey, accessCredential); } record.updatedAt = new Date().toISOString(); await vaultDb.put(record); session.records = await vaultDb.all(); renderPurseSelect(); renderPurse(); notify("Shared passkey access is active. Daily unlock no longer asks for the recovery passphrase."); } catch (error) { notify(passkeyErrorMessage(error, "activation"), true); } }
async function unlockWithPasskey() { const record = selectedRecord(); if (!record?.keyEnvelopes?.passkey) return; try { const vaultKey = await openPasskeyEnvelope(record.keyEnvelopes.passkey); const payload = normalizePayload(decryptPayloadWithVaultKey(record.encrypted, vaultKey)); session.unlocked = { record, payload, vaultKey }; showUnlockedPurse(); await refreshChain(); notify("Purse unlocked with your shared passkey."); } catch (error) { notify(passkeyErrorMessage(error), true); } }
async function deletePurse() { const record = requireUnlocked().record; if (!confirm(`Delete the local encrypted copy of “${record.name}”?\n\nOnly continue if you have tested its encrypted backup and know its passphrase.`)) return; await vaultDb.delete(record.id); session.records = await vaultDb.all(); lockPurse(); if (session.records.length) showUnlock(session.records[0]); else showSetup(); notify("The local encrypted purse copy was deleted."); }
async function importVault(file) { const exported = JSON.parse(await file.text()); const importedRecord = exported?.purse; const expectedFormat = exported?.exportFormat; if (![VAULT_FORMAT_V1, VAULT_FORMAT_V2].includes(expectedFormat) || !importedRecord?.id || !NETWORKS[importedRecord.network] || !importedRecord.encrypted) throw new Error("That file is not a valid Orange Purse encrypted backup."); const record = JSON.parse(JSON.stringify(importedRecord)); if (record.keyEnvelopes) record.keyEnvelopes.passkey = null; delete record.passkey; record.updatedAt = new Date().toISOString(); const existing = await vaultDb.get(record.id); if (existing && !confirm(`A local copy of “${record.name}” already exists. Replace it with this imported backup?`)) return; await vaultDb.put(record); session.records = await vaultDb.all(); session.selectedId = record.id; elements.importDialog.close(); showUnlock(record); notify("Encrypted backup imported. Use its recovery passphrase, then activate passkey-only access here."); }
function setActiveTab(name) { document.querySelectorAll(".tab").forEach((tab) => { const active = tab.dataset.tab === name; tab.classList.toggle("active", active); tab.setAttribute("aria-selected", String(active)); }); document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${name}`)); }
async function initialize() { session.records = await vaultDb.all(); if (!session.records.length) return showSetup(); session.selectedId = session.records.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0].id; showUnlock(selectedRecord()); const navigation = performance.getEntriesByType("navigation")[0]; if (navigation?.type === "reload") notify("Purse is locked because this page was reloaded. Unlock state is intentionally kept only in memory."); }
function renderNetworkChoice() { const mainnet = elements.purseNetwork.value === "mainnet"; elements.mainnetConfirmWrap.hidden = !mainnet; elements.mainnetConfirm.required = mainnet; if (!mainnet) elements.mainnetConfirm.checked = false; elements.networkHelp.className = `network-help wide ${mainnet ? "mainnet" : "testnet4"}`; elements.networkHelp.innerHTML = mainnet ? "<strong>Mainnet uses real bitcoin.</strong> This experimental 1-of-1 purse is for deliberate, small-value testing only." : "<strong>Testnet4 uses valueless test bitcoin.</strong> Practice creation, recovery, receiving, and later sending here."; elements.createSubmit.innerHTML = `${mainnet ? "Create & protect Mainnet purse" : "Create & protect Testnet4 purse"} <span>→</span>`; }

elements.purseNetwork.addEventListener("change", renderNetworkChoice);
elements.create.addEventListener("submit", async (event) => { event.preventDefault(); const name = elements.purseName.value.trim(); const network = elements.purseNetwork.value; const passphrase = elements.createPassphrase.value; if (passphrase !== elements.createPassphraseConfirm.value) return notify("The two passphrases do not match.", true); if (network === "mainnet" && !elements.mainnetConfirm.checked) return notify("Confirm the mainnet recovery warning first.", true); try { await createPurse({ name, network, passphrase }); elements.create.reset(); } catch (error) { notify(error.message || "Could not create this purse.", true); } });
elements.unlockForm.addEventListener("submit", async (event) => { event.preventDefault(); const record = selectedRecord(); if (!record) return; try { const passphrase = elements.unlockPassphrase.value; let payload; let vaultKey; let legacyPassphrase; if (isV2(record)) { vaultKey = await openRecoveryEnvelope(record.keyEnvelopes.recovery, passphrase); payload = decryptPayloadWithVaultKey(record.encrypted, vaultKey); } else { payload = decryptLegacyPayload(record.encrypted, passphrase); legacyPassphrase = passphrase; } payload = normalizePayload(await payload); session.unlocked = { record, payload, vaultKey, legacyPassphrase }; showUnlockedPurse(); if (!record.keyEnvelopes?.passkey) notify("Recovered. Activate passkey-only access in the Vault tab before everyday use."); await refreshChain(); } catch (error) { notify(error.message || "Could not unlock that purse.", true); } });
elements.choosePurse.addEventListener("click", () => { elements.setup.hidden = false; elements.unlock.hidden = true; }); elements.purseSelect.addEventListener("change", () => showUnlock(session.records.find((record) => record.id === elements.purseSelect.value))); elements.newPurse.addEventListener("click", showSetup); elements.lock.addEventListener("click", () => showUnlock(selectedRecord())); elements.refresh.addEventListener("click", refreshChain); elements.refreshActivity.addEventListener("click", refreshChain); elements.newAddress.addEventListener("click", createNextAddress); elements.copyAddress.addEventListener("click", copyCurrentAddress); elements.reviewSend.addEventListener("click", reviewSingleSend); elements.validateBatch.addEventListener("click", reviewBatchSend); elements.exportVault.addEventListener("click", exportVault); elements.registerPasskey.addEventListener("click", activatePasskeyForPurse); elements.approvePasskey.addEventListener("click", unlockWithPasskey); elements.deletePurse.addEventListener("click", deletePurse); elements.openImport.addEventListener("click", () => elements.importDialog.showModal()); elements.importForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await importVault(elements.importFile.files[0]); } catch (error) { notify(error.message || "Could not import this backup.", true); } }); document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setActiveTab(tab.dataset.tab)));

renderNetworkChoice(); initialize().catch((error) => notify(error.message || "Could not open local purse storage.", true));
window.orangePurse = { VERSION, vaultDb, accessDb, refreshChain, buildSpendPlan, transactionVbytes };

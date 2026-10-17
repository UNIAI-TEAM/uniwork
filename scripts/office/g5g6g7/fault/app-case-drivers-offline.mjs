// Case drivers of the G7-03b offline-library fault rows (UNI-1382, W1): FL-01,
// FL-03, FL-07, FL-08. They are registered exactly like BLOCKED_DRIVERS
// (app-cases.mjs) and use the same `ctx` (app-cases.mjs `runOne`).
//
// What makes an FL row different from an FQ row: its observable is NOT the
// intent trace. An offline row's state lives in the sync center's snapshot
// (`window.uniworkSyncCenter.getSnapshot().offline.rows[].state`, the S3 tab
// "Dùng khi không có mạng"; fork shared/offline-library.ts `OfflineRowView`),
// and its actions go through the app's own IPC intents
// (`offlinePin` / `offlineDownloadNow` / `offlineOpen`) - never through a store
// file, which no driver may write. The evidence beside the snapshot is the store
// BEFORE/AFTER: record names, sizes and the sha256 of the CIPHERTEXT only, plus
// the plaintext copy folders by NAME AND SIZE (their bytes are never read), so
// no plaintext, key or token can reach an artifact.
//
// Every number these drivers compare comes from the row's `expect` in
// cases.json (`ctx.expect.offline(...)`, `ctx.expect.proxy(...)`); a driver
// holds the scenario, never a value of its own. `ctx.expect.offline(key)`
// throws when the row does not carry the key, so a scenario and its numbers
// cannot drift.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppBlocked, closeApp, signIn, signOut, signedOutFacts } from "./app-session.mjs";
import { assertion, commitPosts, uploadPosts } from "./app-cases-lib.mjs";
import { countAssertion, deltaAssertion } from "./app-case-drivers.mjs";

/** How long one library download may take before the row is read as never reached (ms). */
export const OFFLINE_DOWNLOAD_TIMEOUT_MS = 180_000;
/** How long a row may take to leave a faulted state (ms). */
export const OFFLINE_STATE_TIMEOUT_MS = 120_000;
/** Poll interval of the snapshot reads (ms). */
export const OFFLINE_POLL_MS = 500;

/**
 * The deployment id FL-08 switches to. A store segment (fork keys.ts SEGMENT:
 * `^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$`), so the fork accepts it as a scope.
 */
export const FL08_DEPLOYMENT_B = "fl08-alt";

/**
 * S3 = Settings > Sync center > "Dùng khi không có mạng". The tab is opened the
 * way the product's own `openSyncCenter('offline')` opens it
 * (renderer/src/offline-library-model.ts:350-354): the tab event first, then the
 * settings event, so a panel already open lands on the offline tab.
 *
 * OPEN QUESTION (W1): the two event names and the settings section id are the
 * fork's renderer contract (offline-library-model.ts TAB_EVENT,
 * SettingsModal.tsx `SettingsSectionId` 'sync'); they are named here as
 * constants so a rename shows up in one place. The selectors are the ones
 * SyncCenterPane.tsx renders (`id={`${base}-tab-offline`}`, role="tabpanel").
 */
export const SYNC_CENTER_TAB_EVENT = "uniwork:sync-center-tab";
export const OPEN_SETTINGS_EVENT = "uniwork:open-settings";
export const SYNC_SETTINGS_SECTION = "sync";
export const S3_TAB_ID = "offline";
export const S3_TAB_SELECTOR = '[role="tab"][id$="-tab-offline"]';
export const S3_PANEL_SELECTOR = '[role="tabpanel"]';
/**
 * S11 = the lock panel of an offline copy that cannot be opened. OPEN QUESTION
 * (W1): the panel carries no stable data attribute the runner can address yet
 * (fork renderer/uniwork-lock-model.ts keys the copy, not a DOM hook), so the
 * selector is a class-prefix match on the fork's own lock markup. The verdict is
 * never taken from the screenshot: it is `offlineOpen()`'s `lockReason` and the
 * S3 row state.
 */
export const S11_LOCK_SELECTOR = '[class*="lock" i]';

// ---- paths of the fork's stores -------------------------------------------------

/** fork wiring.ts:413 `userData/uniwork-sync/library/store` + the scope + the store name. */
export const libraryStoreDir = (userDataDir, deploymentId, accountId) =>
  join(userDataDir, "uniwork-sync", "library", "store", deploymentId, accountId, "offline-library");

/** fork wiring.ts:384 `userData/uniwork-sync/store` + the scope + the lease store name (lease/store.ts:31). */
export const leaseStoreDir = (userDataDir, deploymentId, accountId) =>
  join(userDataDir, "uniwork-sync", "store", deploymentId, accountId, "offline-leases");

/** the plaintext copy folders of every account of one deployment (fork copies.ts:203 + binding-store layout). */
export const copiesRootDir = (userDataDir, deploymentId) => join(userDataDir, "uniwork-documents", deploymentId);

/** the document-key folder of one offline copy (fork copies.ts:136-139: sha256(id) + '@offline'). */
export const offlineCopyKey = (documentId) => `${createHash("sha256").update(String(documentId)).digest("hex")}@offline`;

/** fork store/paths.ts `recordFileName`: a record is named by the hash of its key. */
export const recordName = (key) => `${createHash("sha256").update(String(key), "utf8").digest("hex")}.rec`;

/** the record names of the pin rows of `documentIds` (fork store.ts `pinKey`). */
export const pinRecordNames = (documentIds) => documentIds.map((id) => recordName(`pin/${id}`));

/** the record name of the library index (fork store.ts `LIBRARY_INDEX_KEY`). */
export const INDEX_RECORD_NAME = recordName("index");

// ---- reading the offline library (snapshot) -------------------------------------

/** The `offline` slice of the sync-center snapshot, or null when the app cannot answer. */
export const offlineSnapshot = (session) =>
  session.shell
    .evaluate(async () => {
      const api = window.uniworkSyncCenter;
      if (!api?.getSnapshot) return null;
      const snapshot = await api.getSnapshot();
      return snapshot?.offline ?? null;
    })
    .catch(() => null);

/** The S3 rows of a snapshot (empty for a null snapshot: a signed-out app keeps no names). */
export const rowsOf = (snapshot) => (Array.isArray(snapshot?.rows) ? snapshot.rows : []);

/** The row of one document, or null. */
export const rowOf = (snapshot, documentId) => rowsOf(snapshot).find((row) => row.documentId === documentId) ?? null;

/** The row state of one document, or null when the row is absent. */
export const rowStateOf = (snapshot, documentId) => rowOf(snapshot, documentId)?.state ?? null;

/** Pin one document through the app's real intent (`window.uniworkSyncCenter.offlinePin`). */
export const pinDocument = (session, { documentId, workspaceId }) =>
  session.shell
    .evaluate(
      async ([id, ws]) => {
        const api = window.uniworkSyncCenter;
        if (!api?.offlinePin) return { ok: false, code: "no_offline_pin_api" };
        return api.offlinePin({ documentId: id, workspaceId: ws });
      },
      [documentId, workspaceId],
    )
    .catch((error) => ({ ok: false, code: `offlinePin_threw: ${error?.message ?? error}` }));

/** Retry / download now (`Thử lại` / `Tải ngay`) through the app's own intent. */
export const downloadNow = (session, documentId) =>
  session.shell
    .evaluate(async (id) => {
      const api = window.uniworkSyncCenter;
      if (!api?.offlineDownloadNow) return { ok: false, code: "no_offline_download_api" };
      return api.offlineDownloadNow(id);
    }, documentId)
    .catch((error) => ({ ok: false, code: `offlineDownloadNow_threw: ${error?.message ?? error}` }));

/** S3 `Mở`: the server path when it opens, else the refusal naming the S11 reason. */
export const offlineOpen = (session, documentId) =>
  session.shell
    .evaluate(async (id) => {
      const api = window.uniworkSyncCenter;
      if (!api?.offlineOpen) return { ok: false, code: "no_offline_open_api" };
      return api.offlineOpen(id);
    }, documentId)
    .catch((error) => ({ ok: false, code: `offlineOpen_threw: ${error?.message ?? error}` }));

/**
 * Waits until the document's row state is one of `states` (values of the fork's
 * OFFLINE_ROW_STATES). Returns `{state, row}` or null when the timeout passes.
 */
export async function waitRowState(session, documentId, states, { timeout = OFFLINE_STATE_TIMEOUT_MS, interval = OFFLINE_POLL_MS } = {}) {
  const wanted = [].concat(states);
  const deadline = Date.now() + timeout;
  for (;;) {
    const snapshot = await offlineSnapshot(session);
    const state = rowStateOf(snapshot, documentId);
    if (state && wanted.includes(state)) return { state, row: rowOf(snapshot, documentId) };
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Samples the row state until it reaches one of `until` (or the timeout passes),
 * returning every state seen in order: the only way to assert "never ready
 * before the download finished" from a polled surface. `found` is the state the
 * wait ended on, null on timeout.
 */
export async function watchRowStates(session, documentId, { until, timeout = OFFLINE_STATE_TIMEOUT_MS, interval = OFFLINE_POLL_MS } = {}) {
  const wanted = [].concat(until);
  const seen = [];
  const deadline = Date.now() + timeout;
  for (;;) {
    const state = rowStateOf(await offlineSnapshot(session), documentId);
    if (state && seen[seen.length - 1] !== state) seen.push(state);
    if (state && wanted.includes(state)) return { states: seen, found: state };
    if (Date.now() > deadline) return { states: seen, found: null };
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * `waitRowState` with the product/VM split: a wait that never satisfied while the
 * app is still alive is the product's own verdict (null: the driver FAILs on it);
 * a wait whose app died is a precondition of the VM - BLOCKED, never FAIL
 * (`ctx.appAlive` is the runner's liveness probe; a test passes its own).
 */
export async function awaitRowState(ctx, session, documentId, states, { timeout = OFFLINE_STATE_TIMEOUT_MS } = {}) {
  const found = await waitRowState(session, documentId, states, { timeout });
  if (found) return found;
  const alive = await ctx.appAlive(session);
  if (!alive) throw new AppBlocked(`the app stopped before the row reached ${[].concat(states).join("|")} (harness down; no product claim)`);
  return null;
}

// ---- the store before/after collector -------------------------------------------

const sha256Of = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every `.rec` record of a store directory: name, size and the sha256 of its CIPHERTEXT. */
export function listStoreRecords(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".rec")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (!stat.isFile()) continue;
    out.push({ name, sizeBytes: stat.size, sha256: sha256Of(full) });
  }
  return out;
}

/**
 * The plaintext copy folders of one deployment: the account segment, the copy
 * folder and each file's NAME AND SIZE only - the bytes are never read, so no
 * plaintext can reach an artifact.
 */
export function listPlaintextCopies(userDataDir, deploymentId) {
  const root = copiesRootDir(userDataDir, deploymentId);
  if (!existsSync(root)) return [];
  const out = [];
  for (const accountId of readdirSync(root).sort()) {
    const accountDir = join(root, accountId);
    if (!statSync(accountDir).isDirectory()) continue;
    for (const documentKey of readdirSync(accountDir).sort()) {
      const copyDir = join(accountDir, documentKey);
      if (!statSync(copyDir).isDirectory()) continue;
      for (const name of readdirSync(copyDir).sort()) {
        const file = join(copyDir, name);
        if (!statSync(file).isFile()) continue;
        out.push({ accountId, documentKey, name, sizeBytes: statSync(file).size });
      }
    }
  }
  return out;
}

/**
 * The offline-library evidence of one run: the library and lease store records
 * (ciphertext only) and the plaintext copy folders (names and sizes only).
 * `documentIds` names the pin rows the run pinned.
 */
export function collectOfflineState({ userDataDir, deploymentId, accountId, documentIds = [] }) {
  return {
    deploymentId,
    accountId,
    library: listStoreRecords(libraryStoreDir(userDataDir, deploymentId, accountId)),
    leases: listStoreRecords(leaseStoreDir(userDataDir, deploymentId, accountId)),
    pinRecords: pinRecordNames(documentIds),
    copies: listPlaintextCopies(userDataDir, deploymentId),
  };
}

/** What changed between two collector readings: added / removed / changed records by name. */
export function storeDelta(before, after) {
  const index = (state) => new Map((state?.library ?? []).map((record) => [record.name, record]));
  const was = index(before);
  const now = index(after);
  return {
    added: [...now.keys()].filter((name) => !was.has(name)).sort(),
    removed: [...was.keys()].filter((name) => !now.has(name)).sort(),
    changed: [...now.keys()].filter((name) => was.has(name) && was.get(name).sha256 !== now.get(name).sha256).sort(),
    unchanged: [...now.keys()].filter((name) => was.has(name) && was.get(name).sha256 === now.get(name).sha256).sort(),
  };
}

/**
 * Flips one byte in every CIPHERTEXT blob record of a library store, leaving the
 * index and the pin rows alone: a record is named by the hash of its key (fork
 * store/paths.ts), so the tamper hits exactly the pinned bytes and never the row
 * that names them - a tampered row would make the row vanish instead of reading
 * `corrupt` (FL-03's scenario). Returns the tampered names with the hash each
 * one carries AFTER the flip.
 */
export function tamperLibraryBlobs(dir, { documentIds = [], flip = 0x01 } = {}) {
  const keep = new Set([INDEX_RECORD_NAME, ...pinRecordNames(documentIds)]);
  const tampered = [];
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!name.endsWith(".rec") || keep.has(name)) continue;
    const full = join(dir, name);
    const bytes = readFileSync(full);
    if (bytes.length === 0) continue;
    bytes[Math.floor(bytes.length / 2)] ^= flip;
    writeFileSync(full, bytes);
    tampered.push({ name, sha256: sha256Of(full) });
  }
  return tampered;
}

// ---- screenshots (S3 / S11) ------------------------------------------------------

/** Opens S3 the way `openSyncCenter('offline')` does, and waits for its tab. */
export async function openOfflineTab(session, { timeoutMs = 30_000 } = {}) {
  await session.shell
    .evaluate(
      ([tabEvent, settingsEvent, section, tab]) => {
        window.dispatchEvent(new CustomEvent(tabEvent, { detail: { tab } }));
        window.dispatchEvent(new CustomEvent(settingsEvent, { detail: { section } }));
      },
      [SYNC_CENTER_TAB_EVENT, OPEN_SETTINGS_EVENT, SYNC_SETTINGS_SECTION, S3_TAB_ID],
    )
    .catch(() => undefined);
  await session.shell.waitForSelector(S3_TAB_SELECTOR, { timeout: timeoutMs }).catch(() => null);
  return session.shell.$(S3_TAB_SELECTOR) ? S3_TAB_SELECTOR : null;
}

/**
 * One Playwright screenshot of the shell window (the g7-06 capture's own grab
 * options). Returns the path, or null when the app cannot be captured: a
 * screenshot is evidence, never a verdict.
 */
export async function captureShot(session, { selector = null, file, timeoutMs = 15_000 } = {}) {
  try {
    if (selector) await session.shell.waitForSelector(selector, { timeout: timeoutMs });
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, await session.shell.screenshot({ animations: "disabled", caret: "hide" }));
    return file;
  } catch {
    return null;
  }
}

/** S3 shot: the offline tab of the sync center. */
export const captureS3 = (session, { file }) => captureShot(session, { selector: S3_PANEL_SELECTOR, file });

/** S11 shot: the lock panel of a copy that cannot be opened (after `offlineOpen` refused it). */
export const captureS11 = (session, { file }) => captureShot(session, { selector: S11_LOCK_SELECTOR, file });

// ---- shared assertions -----------------------------------------------------------

/** The download GETs of one document that the proxy saw. */
export const downloadRequests = (log, documentId) =>
  log.filter((entry) => entry.method === "GET" && String(entry.path ?? "").startsWith(`/api/v1/documents/${documentId}/download`));

/** The writes of a document outside the offline policy: commit POSTs and upload POSTs. */
export const writesOutsidePolicy = (log, documentId) =>
  log.filter((entry) => entry.method === "POST" && /^\/api\/v1\/documents\/[^/]+\/(versions\/commit|uploads)$/.test(String(entry.path ?? "")) && String(entry.path).includes(`/documents/${documentId}/`));

/** `expect.proxyLog.commitPosts` / `uploadPosts` (0 on every FL row) as one assertion pair. */
export const noWriteAssertions = (ctx, log, documentId) => {
  const writes = writesOutsidePolicy(log, documentId);
  const commits = writes.filter((entry) => /versions\/commit$/.test(entry.path)).length;
  const uploads = writes.filter((entry) => /uploads$/.test(entry.path)).length;
  return [
    countAssertion(ctx, "no_commit_outside_policy", "commitPosts", commits),
    countAssertion(ctx, "no_upload_outside_policy", "uploadPosts", uploads),
  ];
};

/** `offline.expect(key)` (a boolean) against the actual value, as one assertion. */
export const offlineBoolAssertion = (ctx, name, key, actual) => {
  const expected = ctx.expect.offline(key);
  return assertion(name, expected, actual, actual === expected);
};

/** `offline.expect(key)` (a list of states) must contain `actual`. */
export const offlineStateAssertion = (ctx, name, key, actual) => {
  const expected = ctx.expect.offline(key);
  return assertion(name, expected.join("|"), actual ?? "none", expected.includes(actual));
};

/** `offline.expect(key)` (a count) must equal `actual` exactly (the `*Rows` / `*Copies` keys). */
export const offlineCountAssertion = (ctx, name, key, actual) => {
  const expected = ctx.expect.offline(key);
  return assertion(name, expected, actual, actual === expected);
};

/** `offline.expect('<key>Min')` = at least. */
export const offlineMinAssertion = (ctx, name, key, actual) => {
  const expected = ctx.expect.offline(key);
  return assertion(name, `>= ${expected}`, actual, Number.isInteger(actual) && actual >= expected);
};

/**
 * The store evidence of one run, written beside its other artifacts
 * (`offline-store-before.json` / `offline-store-after.json`, cases.json
 * `artifacts`). Ciphertext hashes and plaintext NAMES only, by construction of
 * `collectOfflineState`.
 */
export function writeStoreEvidence(runDirOut, { before, after }) {
  mkdirSync(runDirOut, { recursive: true });
  writeFileSync(join(runDirOut, "offline-store-before.json"), `${JSON.stringify(before, null, 2)}\n`);
  writeFileSync(join(runDirOut, "offline-store-after.json"), `${JSON.stringify(after, null, 2)}\n`);
}

// ---- drivers --------------------------------------------------------------------

/**
 * A fresh document and a fresh app, the row's rules armed BEFORE the pin: the
 * pin's own content download must meet the fault, so nothing opens the document
 * in the editor first (an open downloads the same route and would consume a
 * `nth: 1` rule).
 */
async function offlineFresh(ctx, { rules = [], launch = {} } = {}) {
  const doc = await ctx.newDocument();
  const session = await ctx.launch(launch);
  await ctx.setRules(rules);
  return { doc, session };
}

/**
 * The org capability `office_offline_library` is a precondition of every FL row.
 * It is switched on the way the harness already switches flags: an
 * organization-scoped admin override (app-tenant.mjs, the same route
 * `setSyncWrite` uses). No admin -> BLOCKED, never FAIL.
 */
async function withOfflineCapability(ctx) {
  const blocker = await ctx.ensureAdmin();
  if (blocker) return blocker;
  try {
    await ctx.setOfflineLibrary(true);
  } catch (error) {
    return `office_offline_library override: ${error.message}`;
  }
  return null;
}

const storeArgs = (ctx, documentIds) => ({
  userDataDir: ctx.userDataDir(),
  deploymentId: ctx.deploymentId(),
  accountId: ctx.tenant.app.userId,
  documentIds,
});

// ---- FL-01: an interrupted library download never reads ready ---------------------
async function fl01(ctx) {
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return { documentId: null, assertions: [], blocker };
  const { doc, session } = await offlineFresh(ctx, { rules: ctx.caseRules(["cut-download"]) });
  const faulted = ctx.expect.offline("faultedStates");
  const recovered = ctx.expect.offline("recoveredStates");
  // the row states it: the faulted watch must never pass through `ready`
  const neverReady = ctx.expect.offline("neverReadyWhileFaulted");
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const watch = await watchRowStates(session, doc.id, { until: faulted, timeout: OFFLINE_DOWNLOAD_TIMEOUT_MS });
  const faultedDownloads = downloadRequests(await ctx.proxyLog(), doc.id).length;
  await ctx.clearRules();
  const retry = await downloadNow(session, doc.id);
  const recoveredRow = await awaitRowState(ctx, session, doc.id, recovered);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, after });
  // the shot is evidence: open S3 first, then grab the panel it renders
  await openOfflineTab(session);
  await captureS3(session, { file: ctx.artifactPath("s3-offline-tab.png") });
  const delta = storeDelta(before, after);
  return {
    documentId: doc.id,
    assertions: [
      assertion("pin_accepted", "ok", pinned?.ok === true ? "ok" : pinned?.code ?? "no answer", pinned?.ok === true),
      assertion("row_faulted", faulted.join("|"), watch.states.join(" → ") || "(no row seen)", Boolean(watch.found)),
      assertion("never_ready_while_faulted", `never ${recovered.join("|")}`, watch.states.join(" → ") || "(no row seen)", neverReady ? !watch.states.includes("ready") : true),
      assertion("retry_accepted", "ok", retry?.ok === true ? "ok" : retry?.code ?? "no answer", retry?.ok === true),
      assertion("row_recovered", recovered.join("|"), recoveredRow?.state ?? "never", Boolean(recoveredRow)),
      offlineBoolAssertion(ctx, "capability_on", "capabilityOn", (await offlineSnapshot(session))?.capabilityOn === true),
      offlineMinAssertion(ctx, "download_requests", "downloadRequestsMin", downloadRequests(log, doc.id).length),
      assertion("faulted_before_retry", ">= 1 download while faulted", faultedDownloads, faultedDownloads >= 1),
      assertion("store_gained_the_pinned_copy", ">= 1 library record", delta.added.length, delta.added.length >= 1),
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FL-03: a tampered cache is never served --------------------------------------
async function fl03(ctx) {
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return { documentId: null, assertions: [], blocker };
  const { doc, session } = await offlineFresh(ctx);
  const accepts = ctx.expect.offline("tamperAccepts");
  const neverStates = ctx.expect.offline("tamperNeverStates");
  const first = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  await closeApp(session);
  const tampered = tamperLibraryBlobs(libraryStoreDir(ctx.userDataDir(), ctx.deploymentId(), ctx.tenant.app.userId), { documentIds: [doc.id] });
  const tamperedNames = new Set(tampered.map((record) => record.name));
  const second = await ctx.launch({ requireSignIn: false });
  await ctx.waitSignedIn(second);
  const row = await awaitRowState(ctx, second, doc.id, [...accepts, ...neverStates]);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, after });
  const opened = await offlineOpen(second, doc.id);
  // S11 = the lock panel of a copy that could not be opened: open S3 first so the
  // panel that carries the refusal is rendered, then grab it (evidence only)
  await openOfflineTab(second);
  await captureS11(second, { file: ctx.artifactPath("s11-lock-panel.png") });
  // S3 beside it: the `corrupt` row the row asserts on, on the same surface
  await captureS3(second, { file: ctx.artifactPath("s3-offline-tab.png") });
  // "never served": a row reads `ready` only when the bytes under it verified, so a
  // tampered ciphertext still on disk beside a `ready` row is the product serving it.
  const stillTampered = after.library.some((record) => tamperedNames.has(record.name));
  const servedTampered = stillTampered && row?.state === "ready";
  const redownloaded = downloadRequests(log, doc.id).length > before.library.length;
  const stateOk = Boolean(row?.state) && (accepts.includes(row.state) || redownloaded);
  return {
    documentId: doc.id,
    assertions: [
      assertion("pin_accepted", "ok", first?.ok === true ? "ok" : first?.code ?? "no answer", first?.ok === true),
      assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      assertion("blobs_tampered", ">= 1 ciphertext record", tampered.length, tampered.length >= 1),
      assertion("row_state_after_tamper", `${accepts.join("|")} hoặc tải lại`, row?.state ?? "no row", stateOk),
      assertion("never_served_tampered_bytes", "no ready row over tampered ciphertext", servedTampered ? "served" : "not served", !servedTampered),
      assertion("open_never_served_it", "a refusal naming the reason, or a real open", opened?.ok === true ? "opened (re-downloaded)" : opened?.lockReason ?? opened?.code ?? "no answer", !servedTampered),
      offlineMinAssertion(ctx, "download_after_tamper", "downloadRequestsMin", downloadRequests(log, doc.id).length),
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FL-07: sign-out A, sign-in B ------------------------------------------------
async function fl07(ctx) {
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return { documentId: null, assertions: [], blocker };
  const { doc, session } = await offlineFresh(ctx);
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  await signOut(session);
  const facts = await signedOutFacts(session);
  const signedOutReading = await offlineSnapshot(session);
  const afterSignOut = collectOfflineState(storeArgs(ctx, [doc.id]));
  // S3 shot while A is signed out: the surface that must keep no document name,
  // plus S11 - A's copy is locked at this boundary, which is what S11 shows
  await openOfflineTab(session);
  await captureS3(session, { file: ctx.artifactPath("s3-offline-tab.png") });
  await captureS11(session, { file: ctx.artifactPath("s11-lock-panel.png") });
  await signIn(session, ctx.tenant.apiOrigin, ctx.tenant.foreign);
  const bSnapshot = await offlineSnapshot(session);
  const bRows = rowsOf(bSnapshot);
  const bCopies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId());
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, after });
  // A's own records must be gone from A's scope: the sign-out boundary wipes it.
  const aRecordsLeft = afterSignOut.library.filter((record) => before.library.some((was) => was.name === record.name)).length;
  return {
    documentId: doc.id,
    assertions: [
      assertion("pin_accepted", "ok", pinned?.ok === true ? "ok" : pinned?.code ?? "no answer", pinned?.ok === true),
      assertion("ready_before_sign_out", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      offlineBoolAssertion(ctx, "account_a_locked_while_signed_out", "accountALockedWhileSignedOut", facts?.status === "signed_out"),
      offlineBoolAssertion(ctx, "account_a_scope_wiped", "accountAScopeWiped", aRecordsLeft === 0),
      offlineBoolAssertion(ctx, "signed_out_surface_keeps_no_name", "signedOutKeepsNoName", rowsOf(signedOutReading).length === 0),
      offlineCountAssertion(ctx, "account_b_rows", "accountBRows", bRows.length),
      offlineCountAssertion(ctx, "account_b_copies", "accountBCopies", bCopies.length),
      assertion("account_b_sees_no_document_name", "0 rows naming a document", bRows.map((row) => row.name).join(", ") || "(none)", bRows.length === 0),
      ...noWriteAssertions(ctx, await ctx.proxyLog(), doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

// ---- FL-08: deployment switch -----------------------------------------------------
async function fl08(ctx) {
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return { documentId: null, assertions: [], blocker };
  const { doc, session } = await offlineFresh(ctx);
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  const aPinRecords = before.pinRecords.filter((name) => before.library.some((record) => record.name === name)).length;
  await closeApp(session);
  const bSession = await ctx.launch({ requireSignIn: false, deploymentId: FL08_DEPLOYMENT_B });
  const bSnapshot = await offlineSnapshot(bSession);
  const bRows = rowsOf(bSnapshot);
  const bCopies = listPlaintextCopies(ctx.userDataDir(), FL08_DEPLOYMENT_B);
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  const delta = storeDelta(before, after);
  writeStoreEvidence(ctx.runDirOut(), { before, after });
  // S3 on deployment B: the empty library the row claims, captured as evidence
  await openOfflineTab(bSession);
  await captureS3(bSession, { file: ctx.artifactPath("s3-offline-tab.png") });
  return {
    documentId: doc.id,
    assertions: [
      assertion("pin_accepted", "ok", pinned?.ok === true ? "ok" : pinned?.code ?? "no answer", pinned?.ok === true),
      assertion("ready_before_switch", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      offlineCountAssertion(ctx, "deployment_b_rows", "deploymentBRows", bRows.length),
      offlineCountAssertion(ctx, "deployment_b_copies", "deploymentBCopies", bCopies.length),
      offlineCountAssertion(ctx, "deployment_a_rows", "deploymentARows", aPinRecords),
      offlineBoolAssertion(ctx, "deployment_a_scope_unchanged", "deploymentAScopeUnchanged", delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0),
      assertion("deployment_b_library_empty", "0 rows on deployment B", bRows.length, bRows.length === 0),
      ...noWriteAssertions(ctx, await ctx.proxyLog(), doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

export const OFFLINE_DRIVERS = { "FL-01": fl01, "FL-03": fl03, "FL-07": fl07, "FL-08": fl08 };

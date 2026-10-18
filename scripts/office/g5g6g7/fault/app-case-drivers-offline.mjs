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
import { AppBlocked, closeApp, signOut, signedOutFacts } from "./app-session.mjs";
import { assertion, commitPosts, uploadPosts } from "./app-cases-lib.mjs";
import { countAssertion, deltaAssertion } from "./app-case-drivers.mjs";

// The waits are the product's own pace on the cloud VM. The three knobs below exist
// only so the node:test fakes (app-cases-fl-drivers.test.mjs) can run a wait that
// never completes in milliseconds; a cloud run never sets them.
const envMs = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};
/** How long one library download may take before the row is read as never reached (ms). */
export const OFFLINE_DOWNLOAD_TIMEOUT_MS = envMs("UNIWORK_FL_DOWNLOAD_TIMEOUT_MS", 180_000);
/** How long a row may take to leave a faulted state (ms). */
export const OFFLINE_STATE_TIMEOUT_MS = envMs("UNIWORK_FL_STATE_TIMEOUT_MS", 120_000);
/** Poll interval of the snapshot reads (ms). */
export const OFFLINE_POLL_MS = envMs("UNIWORK_FL_POLL_MS", 500);

/**
 * The deployment id FL-08 switches to. A store segment (fork keys.ts SEGMENT:
 * `^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$`), so the fork accepts it as a scope.
 */
export const FL08_DEPLOYMENT_B = "fl08-alt";

/**
 * S3 = Settings > Sync center > "Dùng khi không có mạng". Opened the way the
 * product's own `openSyncCenter('offline')` opens it
 * (renderer/src/offline-library-model.ts:345-354): `requestedTab` is read by a
 * pane that MOUNTS, so an event dispatched before the pane exists is lost. The
 * runner therefore opens Settings first, waits for the pane, and then CLICKS the
 * offline tab (review r1 R1-10) - the tab event alone leaves an already-open pane
 * on its default tab (`SyncCenterPane.tsx:117,175-181`).
 *
 * Selectors verified against the fork at aae163aed (renderer/src/SyncCenterPane.tsx:667-708):
 * the tab button is `id={`${base}-tab-${id}`}` with `role="tab"` and the active
 * panel is `id={`${base}-panel-${id}`}` with `role="tabpanel"`.
 */
export const OPEN_SETTINGS_EVENT = "uniwork:open-settings";
export const SYNC_SETTINGS_SECTION = "sync";
export const S3_TAB_ID = "offline";
export const S3_TAB_SELECTOR = '[role="tab"][id$="-tab-offline"]';
export const S3_PANEL_SELECTOR = '[role="tabpanel"][id$="-panel-offline"]';
/**
 * S11 = the lock panel of a copy that cannot be opened
 * (renderer/src/UniworkLockPanel.tsx:210-211 renders `.uw-lock-layer` wrapping
 * `.uw-lock-panel`). A class-prefix match such as `[class*="lock" i]` also
 * matches the fork's `sc-lock` / `wb-block` / `set-ai-block` classes, so it is
 * NOT a lock. The verdict is still never taken from the screenshot: it is
 * `offlineOpen()`'s `lockReason` and the S3 row state; the shot is evidence.
 */
export const S11_LOCK_SELECTOR = ".uw-lock-layer .uw-lock-panel";

// ---- paths of the fork's stores -------------------------------------------------

/** fork wiring.ts:413 `userData/uniwork-sync/library/store` + the scope + the store name. */
export const libraryStoreDir = (userDataDir, deploymentId, accountId) =>
  join(userDataDir, "uniwork-sync", "library", "store", deploymentId, accountId, "offline-library");

/**
 * Every store registered in the fork's sync layer (session-store.ts
 * `SYNC_STORE_REGISTRATIONS`, wiring.ts:367-425): the offline library's own
 * layer is separate (`libraryStoreDir`), these live under the account's sync
 * store scope. FL-08 claims A's "cursor/cache" is untouched, so the collector
 * hashes these too (review r1 R1-8) - the library array alone never saw them.
 */
export const SYNC_STORE_NAMES = Object.freeze(["intents", "drafts", "pause", "parked", "feed-cursors", "doc-index", "offline-leases"]);

/** one registered sync store's folder of one scope (fork store/paths.ts `storeDirFor`). */
export const syncStoreDir = (userDataDir, deploymentId, accountId, store) =>
  join(userDataDir, "uniwork-sync", "store", deploymentId, accountId, store);

/** fork wiring.ts:384 `userData/uniwork-sync/store` + the scope + the lease store name (lease/store.ts:31). */
export const leaseStoreDir = (userDataDir, deploymentId, accountId) => syncStoreDir(userDataDir, deploymentId, accountId, "offline-leases");

/** the plaintext copy folders of every account of one deployment (fork copies.ts:203 + binding-store layout). */
export const copiesRootDir = (userDataDir, deploymentId) => join(userDataDir, "uniwork-documents", deploymentId);

/** the suffix of an offline copy folder (fork offline-library/copies.ts `OFFLINE_COPY_KEY_SUFFIX`). */
export const OFFLINE_COPY_KEY_SUFFIX = "@offline";

/** the document-key folder of one offline copy (fork copies.ts:136-139: sha256(id) + '@offline'). */
export const offlineCopyKey = (documentId) => `${createHash("sha256").update(String(documentId)).digest("hex")}${OFFLINE_COPY_KEY_SUFFIX}`;

/** fork store/paths.ts `recordFileName`: a record is named by the hash of its key. */
export const recordName = (key) => `${createHash("sha256").update(String(key), "utf8").digest("hex")}.rec`;

/** the record names of the pin rows of `documentIds` (fork store.ts `pinKey`). */
export const pinRecordNames = (documentIds) => documentIds.map((id) => recordName(`pin/${id}`));

/** the record name of the library index (fork store.ts `LIBRARY_INDEX_KEY`). */
export const INDEX_RECORD_NAME = recordName("index");

// ---- reading the offline library (snapshot) -------------------------------------

/**
 * Why an offline slice is not the fork's `OfflineLibrarySnapshot` (shared/
 * offline-library.ts): an object whose `rows` is an array of rows that each
 * carry a string `documentId`, `name` and `state`. null when the shape holds
 * (review r2 R2-2): `{}`, an array or `rows: null` must never read as "0 rows".
 */
export function offlineSliceShapeError(slice) {
  if (slice === null || typeof slice !== "object" || Array.isArray(slice)) return "the offline slice is not an object";
  if (!Array.isArray(slice.rows)) return "offline.rows is not an array";
  const bad = slice.rows.findIndex(
    (row) => row === null || typeof row !== "object" || ["documentId", "name", "state"].some((field) => typeof row[field] !== "string"),
  );
  return bad < 0 ? null : `offline.rows[${bad}] lacks a string documentId/name/state`;
}

/**
 * The raw answer of one snapshot read: `{answered, snapshot, shapeError}`.
 * `answered` is false when the app could not answer at all (no API, a
 * rejection, an exception), which is a different fact from an empty library
 * (review r1 R1-6): a null slice must never be read as "0 rows". A slice that
 * answered but is not shaped like the fork's carries a `shapeError` (R2-2).
 */
export const offlineSnapshotAnswer = async (session) => {
  try {
    const snapshot = await session.shell.evaluate(async () => {
      const api = window.uniworkSyncCenter;
      if (!api?.getSnapshot) return null;
      return (await api.getSnapshot())?.offline ?? null;
    });
    return { answered: snapshot !== null && typeof snapshot === "object", snapshot, shapeError: snapshot === null ? null : offlineSliceShapeError(snapshot) };
  } catch {
    return { answered: false, snapshot: null, shapeError: null };
  }
};

/** The `offline` slice of the sync-center snapshot, or null when the app cannot answer. */
export const offlineSnapshot = async (session) => (await offlineSnapshotAnswer(session)).snapshot;

/** The S3 rows of a snapshot (empty for a null snapshot: a signed-out app keeps no names). */
export const rowsOf = (snapshot) => (Array.isArray(snapshot?.rows) ? snapshot.rows : []);

/** The row of one document, or null. */
export const rowOf = (snapshot, documentId) => rowsOf(snapshot).find((row) => row.documentId === documentId) ?? null;

/** The row state of one document, or null when the row is absent. */
export const rowStateOf = (snapshot, documentId) => rowOf(snapshot, documentId)?.state ?? null;

/**
 * `expect.offline.firstLaunchStates` of a row: the state(s) the row must read
 * before the scenario's fault (a `ready` precondition on every FL row that
 * pins). Read once here so no driver falls back to a literal (review r1 R1-2).
 */
export const firstLaunchStates = (ctx) => ctx.expect.offline("firstLaunchStates");

/**
 * A snapshot that must ANSWER before a driver reads anything from it (review r1
 * R1-6). A null slice is a different fact from an empty library, and only an
 * answered one may be interpreted: a missing/broken `getSnapshot` while the app
 * is alive is the product's own FAIL, an app that died is the harness's
 * precondition (BLOCKED). `states` (optional) are the row states the snapshot
 * must read for `documentId` before the caller goes on.
 *
 * Returns `{answered, snapshot, failure}`; `failure` is the assertion pair to
 * report when the snapshot did not answer (null when it did).
 */
export async function requireAnsweredSnapshot(ctx, session, name, { documentId = null, states = null } = {}) {
  const { answered, snapshot, shapeError } = await offlineSnapshotAnswer(session);
  if (answered && shapeError) {
    // answered, but not a library: the zero-row claims that lean on it must fail too, so it is not "answered"
    return { answered: false, snapshot: null, failure: assertion("snapshot_shape", "an offline slice with rows[] of {documentId, name, state}", `${name}: ${shapeError}`, false) };
  }
  if (!answered) {
    const alive = await ctx.appAlive(session).catch(() => false);
    if (!alive) throw new AppBlocked(`the app stopped before ${name} could be read (harness down; no product claim)`);
    return { answered: false, snapshot: null, failure: assertion(name, "an answered sync-center snapshot", "the app did not answer getSnapshot()", false) };
  }
  if (documentId && states) {
    const wanted = [].concat(states);
    const state = rowStateOf(snapshot, documentId);
    return {
      answered: true,
      snapshot,
      failure: wanted.includes(state)
        ? null
        : assertion(name, `${wanted.join("|")} on the S3 row`, state ?? "no row", false),
    };
  }
  return { answered: true, snapshot, failure: null };
}

/**
 * The account the app is signed in as, as the app itself reports it
 * (`window.aiOffice.accountStatus()`, fork home-api.ts `AccountStatus`). A
 * sign-in that reached `loggedIn` is not proof it reached the REQUESTED
 * account, so FL-07 compares the id (review r1 R1-7).
 */
export const accountStatusOf = (session) => session.shell.evaluate(() => window.aiOffice?.accountStatus?.() ?? null).catch(() => null);

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

/**
 * `watchRowStates` with the same product/VM split as `awaitRowState` (review r1
 * R1-13): the watch samples a polled surface, so an app that DIED mid-watch
 * reads as "the state never arrived" and would be a product FAIL - it is the
 * harness's precondition instead (BLOCKED, never FAIL). A watch that timed out
 * while the app is still alive is the product's own verdict (returns `found:
 * null`, the driver FAILs on it).
 */
export async function watchRowStatesOrBlocked(ctx, session, documentId, options = {}) {
  const watch = await watchRowStates(session, documentId, options);
  if (watch.found) return watch;
  const alive = await ctx.appAlive(session).catch(() => false);
  if (!alive) throw new AppBlocked(`the app stopped before the row reached ${[].concat(options.until).join("|")} (harness down; no product claim)`);
  return watch;
}

/**
 * Runs one scenario operation with the product/VM split (review r1 R1-13): an
 * error thrown while the app is still alive is the product's own failure and is
 * re-thrown (the runner reports it as a FAIL); an error whose app died is the
 * harness's precondition and becomes `AppBlocked` (the runner reports BLOCKED,
 * never FAIL). `AppBlocked` passes through untouched. A test passes its own
 * `ctx.appAlive`.
 */
export async function withLiveness(ctx, session, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppBlocked) throw error;
    const alive = await ctx.appAlive(session).catch(() => false);
    if (!alive) throw new AppBlocked(`the app stopped during the row (harness down; no product claim): ${error?.message ?? error}`);
    throw error;
  }
}

/**
 * The app's launch, with the same split (review r1 R1-13): an app that never came
 * up is a precondition of the VM (BLOCKED, never a product FAIL).
 */
export async function launchForOffline(ctx, options = {}) {
  try {
    return await ctx.launch(options);
  } catch (error) {
    if (error instanceof AppBlocked) throw error;
    throw new AppBlocked(`the app did not come up for the row (harness precondition): ${error?.message ?? error}`);
  }
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
 * The plaintext copy folders of the accounts in scope (review r1 R1-12): only
 * the `@offline` copy folders of the named accounts, and each entry is the
 * sha256 of the file NAME plus its size - never the name itself, so a store
 * artifact can not disclose a document name. `accountIds` is the run's own
 * account(s); an empty list means every account (used by tests, never by a
 * driver, which always passes the accounts in scope).
 */
export function listPlaintextCopies(userDataDir, deploymentId, { accountIds = [] } = {}) {
  const root = copiesRootDir(userDataDir, deploymentId);
  if (!existsSync(root)) return [];
  const scope = new Set(accountIds);
  const out = [];
  for (const accountId of readdirSync(root).sort()) {
    if (scope.size > 0 && !scope.has(accountId)) continue;
    const accountDir = join(root, accountId);
    if (!statSync(accountDir).isDirectory()) continue;
    for (const copyKey of readdirSync(accountDir).sort()) {
      // an offline copy folder only: the working copies beside it are the editor's, not the library's
      if (!copyKey.endsWith(OFFLINE_COPY_KEY_SUFFIX)) continue;
      const copyDir = join(accountDir, copyKey);
      if (!statSync(copyDir).isDirectory()) continue;
      for (const name of readdirSync(copyDir).sort()) {
        const file = join(copyDir, name);
        if (!statSync(file).isFile()) continue;
        out.push({
          accountId,
          copyKeySha256: createHash("sha256").update(copyKey, "utf8").digest("hex"),
          fileNameSha256: createHash("sha256").update(name, "utf8").digest("hex"),
          sizeBytes: statSync(file).size,
        });
      }
    }
  }
  return out;
}

/**
 * Every `.rec` of every registered sync store of one scope, each tagged with the
 * store it belongs to (review r1 R1-8): the contract's "A's cursor/cache
 * untouched" claim is about `feed-cursors` / `doc-index` / `drafts`, which the
 * library-only delta could never see.
 */
export function listSyncStoreRecords(userDataDir, deploymentId, accountId) {
  return SYNC_STORE_NAMES.flatMap((store) =>
    listStoreRecords(syncStoreDir(userDataDir, deploymentId, accountId, store)).map((record) => ({ store, ...record })),
  );
}

/**
 * The offline-library evidence of one run: every store record of the scope
 * (ciphertext only; `records` is the union the delta compares, `library` and
 * `leases` stay as their own slices) and the plaintext copy folders of
 * `accountIds` (the sha256 of the folder and file NAME, plus sizes - never a
 * name, never a byte). `documentIds` names the pin rows the run pinned.
 */
export function collectOfflineState({ userDataDir, deploymentId, accountId, accountIds = null, documentIds = [] }) {
  const library = listStoreRecords(libraryStoreDir(userDataDir, deploymentId, accountId));
  const syncStores = listSyncStoreRecords(userDataDir, deploymentId, accountId);
  return {
    deploymentId,
    accountId,
    library,
    leases: listStoreRecords(leaseStoreDir(userDataDir, deploymentId, accountId)),
    records: [...library.map((record) => ({ store: "library", ...record })), ...syncStores],
    pinRecords: pinRecordNames(documentIds),
    copies: listPlaintextCopies(userDataDir, deploymentId, { accountIds: accountIds ?? (accountId ? [accountId] : []) }),
  };
}

/**
 * What changed between two collector readings: added / removed / changed records
 * keyed by `store/name`, so a change in any registered store is one delta
 * (review r1 R1-8). A reading without `records` (a test fixture) falls back to
 * its library slice, which is what the pre-R1-8 delta compared.
 */
export function storeDelta(before, after) {
  const recordsOf = (state) => state?.records ?? (state?.library ?? []).map((record) => ({ store: "library", ...record }));
  const keyOf = (record) => `${record.store}/${record.name}`;
  const index = (state) => new Map(recordsOf(state).map((record) => [keyOf(record), record]));
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

/**
 * Opens S3 the way `openSyncCenter('offline')` does and leaves the OFFLINE tab
 * selected (review r1 R1-10): the settings event first, the pane mounts and
 * takes its default tab, then the runner clicks the offline tab and waits for
 * `aria-selected=true` with its panel visible. Returns the selected panel's
 * selector, or null when the tab never came up.
 */
export async function openOfflineTab(session, { timeoutMs = 30_000 } = {}) {
  await session.shell
    .evaluate(
      ([settingsEvent, section]) => {
        window.dispatchEvent(new CustomEvent(settingsEvent, { detail: { section } }));
      },
      [OPEN_SETTINGS_EVENT, SYNC_SETTINGS_SECTION],
    )
    .catch(() => undefined);
  const tab = session.shell.locator(S3_TAB_SELECTOR).first();
  try {
    await tab.waitFor({ state: "visible", timeout: timeoutMs });
    // an already-selected tab is not re-clicked: clicking it is a no-op and the
    // wait below is what proves the selection
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click({ timeout: timeoutMs });
    await session.shell.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute("aria-selected") === "true",
      S3_TAB_SELECTOR,
      { timeout: timeoutMs },
    );
  } catch {
    return null;
  }
  return S3_PANEL_SELECTOR;
}

/**
 * One Playwright screenshot of the shell window (the g7-06 capture's own grab
 * options). Returns the path, or null when the app cannot be captured. A shot
 * is evidence, never a verdict, so a capture failure is classified by the
 * caller: the harness died (BLOCKED) or the surface the row declares is missing
 * (FAIL) - review r1 R1-11.
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

/** S3 shot: the offline tab panel of the sync center (opened and selected by `openOfflineTab`). */
export const captureS3 = (session, { file }) => captureShot(session, { selector: S3_PANEL_SELECTOR, file });

/** S11 shot: the lock panel of a copy that cannot be opened (after `offlineOpen` refused it). */
export const captureS11 = (session, { file }) => captureShot(session, { selector: S11_LOCK_SELECTOR, file });

/**
 * The shot of one artifact a row declares, as an assertion pair (review r1
 * R1-11): a declared shot that did not capture is a FAIL, and one that failed
 * while the app died is the harness's precondition - the caller decides which by
 * the `alive` flag it passes (the runner's `ctx.appAlive`).
 */
export const captureAssertion = (name, artifact, captured, alive) =>
  assertion(name, artifact, captured ?? (alive ? "not captured" : "the app died during the capture"), Boolean(captured));

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
 * `artifacts`). `faulted` is the reading taken while the fault is still armed
 * (FL-01: "no partial ready record while faulted", review r1 R1-14) and is
 * written as `offline-store-faulted.json` when the run takes one. Ciphertext
 * hashes and hashed plaintext names only, by construction of `collectOfflineState`.
 */
export function writeStoreEvidence(runDirOut, { before, faulted = null, after }) {
  mkdirSync(runDirOut, { recursive: true });
  writeFileSync(join(runDirOut, "offline-store-before.json"), `${JSON.stringify(before, null, 2)}\n`);
  if (faulted) writeFileSync(join(runDirOut, "offline-store-faulted.json"), `${JSON.stringify(faulted, null, 2)}\n`);
  writeFileSync(join(runDirOut, "offline-store-after.json"), `${JSON.stringify(after, null, 2)}\n`);
}

/**
 * The proxy log entries one rule id produced, optionally narrowed to one
 * document's routes: the positive evidence that the injected fault really
 * happened, instead of inferring it from a row state another error could also
 * produce (review r1 R1-14).
 */
export const ruleHits = (log, ruleId, documentId = null) =>
  log.filter((entry) => entry.ruleId === ruleId && (!documentId || String(entry.path ?? "").includes(`/documents/${documentId}/`)));

/** The content downloads of one document that reached the upstream server (not reset/dropped). */
export const upstreamDownloads = (log, documentId) =>
  downloadRequests(log, documentId).filter((entry) => Number.isInteger(entry.status));

/**
 * The positive evidence that the injected fault really happened (review r1
 * R1-14): the proxy log entries a rule id produced, as an assertion pair. A row
 * state another error could also produce is never the evidence the fault ran -
 * the rule's own log line is. `status` narrows to the fault's status ("reset" /
 * "dropped" / an HTTP code); `documentId` to that document's routes.
 */
export const ruleHitAssertion = (name, log, ruleId, { documentId = null, status = null } = {}) => {
  const hits = ruleHits(log, ruleId, documentId).filter((entry) => status === null || entry.status === status);
  return assertion(name, `${ruleId}${status ? ` status=${status}` : ""} hit >= 1`, hits.length, hits.length >= 1);
};

/**
 * The deployment the running app effectively reads (review r1 R1-8): the
 * `UNIWORK_DEPLOYMENT_ID` of the app's own main process, plus whether a
 * `deployment-profile.json` exists in its userData. The fork resolves a SAVED
 * profile before the env (uniwork-auth/deployment.ts `resolveDeploymentProfile`),
 * so the env is the effective deployment only while no profile file is saved -
 * which is what the second half of the reading proves.
 */
export async function deploymentEvidence(session, userDataDir) {
  const env = await session.app
    .evaluate(() => process.env.UNIWORK_DEPLOYMENT_ID ?? null)
    .catch(() => null);
  return { env, savedProfile: existsSync(join(userDataDir, "deployment-profile.json")) };
}

/**
 * The S3/S11 shots a row declares, each as its own assertion pair (review r1
 * R1-11): the offline tab is opened and selected first, a declared shot that did
 * not capture FAILs, and a capture that failed while the app died is the
 * harness's precondition - BLOCKED, never FAIL.
 */
export async function captureRowShots(ctx, session, { s3 = false, s11 = false } = {}) {
  const shots = [];
  // the lock panel is what a refused open just raised: it is grabbed before the
  // settings pane is opened over it
  if (s11) shots.push(await captureDeclaredShot(ctx, session, "s11_shot", "s11-lock-panel.png", S11_LOCK_SELECTOR));
  if (s3) {
    // the selection is the shot's precondition (review r2 R2-3): a tab that never
    // came up, or a panel that is not showing right before the capture, is no S3
    await openOfflineTab(session);
    const tab = await selectedTabReading(session);
    if (tab.selected && tab.visible) {
      shots.push(assertion("s3_tab_selected", "aria-selected=true and the panel visible", "selected and visible", true));
      shots.push(await captureDeclaredShot(ctx, session, "s3_shot", "s3-offline-tab.png", S3_PANEL_SELECTOR));
    } else {
      const alive = await ctx.appAlive(session).catch(() => false);
      if (!alive) throw new AppBlocked("the app stopped before the S3 tab could be read (harness down; no product claim)");
      shots.push(assertion("s3_tab_selected", "aria-selected=true and the panel visible", `aria-selected=${tab.selected} panelVisible=${tab.visible}`, false));
      shots.push(captureAssertion("s3_shot", "s3-offline-tab.png", null, true));
    }
  }
  return shots;
}

/** Whether the offline tab is selected AND its panel is visible, read right now (not what a wait once saw). */
async function selectedTabReading(session) {
  try {
    const selected = (await session.shell.locator(S3_TAB_SELECTOR).first().getAttribute("aria-selected", { timeout: 5_000 })) === "true";
    const visible = await session.shell.locator(S3_PANEL_SELECTOR).first().isVisible();
    return { selected, visible: visible === true };
  } catch {
    return { selected: false, visible: false };
  }
}

async function captureDeclaredShot(ctx, session, name, artifact, selector) {
  const captured = await captureShot(session, { selector, file: ctx.artifactPath(artifact) });
  if (captured) return captureAssertion(name, artifact, captured, true);
  const alive = await ctx.appAlive(session).catch(() => false);
  if (!alive) throw new AppBlocked(`the app stopped before ${artifact} could be captured (harness down; no product claim)`);
  return captureAssertion(name, artifact, null, true);
}

// ---- drivers --------------------------------------------------------------------

/**
 * Runs a driver body with the product/VM split on EVERY operation (review r1
 * R1-13): the launch, the sign-out, an evaluate, a tamper - whichever throws.
 * An error while the last launched app is still alive is the product's own
 * failure and is re-thrown (the runner reports a FAIL); an error whose app died
 * is the harness's precondition and becomes `AppBlocked` (BLOCKED). The body gets
 * a ctx whose `launch` is the classified one (an app that never came up is
 * BLOCKED) and whose `close(session)` forgets the closed session, so a later
 * error is judged against the app that is actually running.
 */
export async function runGuarded(ctx, body) {
  const sessions = [];
  const wrapped = {
    ...ctx,
    launch: async (options) => {
      const session = await launchForOffline(ctx, options);
      sessions.push(session);
      return session;
    },
    close: async (session) => {
      await closeApp(session);
      const at = sessions.indexOf(session);
      if (at >= 0) sessions.splice(at, 1);
    },
  };
  try {
    return await body(wrapped);
  } catch (error) {
    if (error instanceof AppBlocked) throw error;
    const last = sessions.at(-1);
    if (last && !(await ctx.appAlive(last).catch(() => false))) {
      throw new AppBlocked(`the app stopped during the row (harness down; no product claim): ${error?.message ?? error}`);
    }
    throw error;
  }
}

/**
 * A fresh document and a fresh app, the row's rules armed BEFORE the pin: the
 * pin's own content download must meet the fault, so nothing opens the document
 * in the editor first (an open downloads the same route and would consume a
 * `nth: 1` rule).
 */
export async function offlineFresh(ctx, { rules = [], launch = {} } = {}) {
  const doc = await ctx.newDocument();
  const session = await ctx.launch(launch);
  await ctx.setRules(rules);
  return { doc, session };
}

/**
 * The org capability `office_offline_library` is a precondition of every FL row.
 * It is switched on through the run's own override (app-offline-flag.mjs: a
 * leftover is cleared first, and only this run lifts it). No admin -> BLOCKED,
 * never FAIL.
 */
export async function withOfflineCapability(ctx) {
  const blocker = await ctx.ensureAdmin();
  if (blocker) return blocker;
  try {
    await ctx.setOfflineLibrary(true);
  } catch (error) {
    return `office_offline_library override: ${error.message}`;
  }
  return null;
}

export const storeArgs = (ctx, documentIds, accountId = ctx.tenant.app.userId) => ({
  userDataDir: ctx.userDataDir(),
  deploymentId: ctx.deploymentId(),
  accountId,
  documentIds,
});

/** One answered pin/retry/open result as an assertion pair (`ok`, or the refusal code). */
export const resultAssertion = (name, result) =>
  assertion(name, "ok", result?.ok === true ? "ok" : result?.code ?? "no answer", result?.ok === true);

/**
 * The pre-state every row that tampers, wipes or compares a store needs: A's pin
 * row and at least one ciphertext blob are really in the store before the fault
 * (review r1 R1-7: an empty or wrong-path pre-store would make every "nothing
 * left" assertion vacuously true).
 */
export function preStoreAssertion(before, documentId) {
  const names = new Set(before.library.map((record) => record.name));
  const pins = pinRecordNames([documentId]);
  const blobs = before.library.filter((record) => record.name !== INDEX_RECORD_NAME && !pins.includes(record.name));
  const ok = pins.every((name) => names.has(name)) && blobs.length >= 1;
  return assertion("pre_store_has_the_pinned_copy", "the pin row and >= 1 ciphertext blob", `${pins.filter((name) => names.has(name)).length}/${pins.length} pin row(s), ${blobs.length} blob(s)`, ok);
}

/**
 * The ciphertext blobs of a library reading: every record that is neither the
 * index nor one of `documentIds`' pin rows (a record is named by the hash of its
 * key, so a blob generation cannot be derived - the exclusion is the definition).
 */
export const libraryBlobs = (state, documentIds) => {
  const pins = pinRecordNames(documentIds);
  return state.library.filter((record) => record.name !== INDEX_RECORD_NAME && !pins.includes(record.name));
};

/** The account the app reports it is signed in as, against the seeded account (review r1 R1-7). */
export async function signedInAsAssertion(session, name, account) {
  const status = await accountStatusOf(session);
  const actual = status?.profile?.accountId ?? status?.state ?? "no answer";
  return assertion(name, account.userId, actual, status?.loggedIn === true && status?.profile?.accountId === account.userId);
}

/** The cut of the content route a forced-offline open needs: every GET …/download is reset (cases.json `cut-open`). */
export const armOpenCut = (ctx) => ctx.setRules(ctx.caseRules(["cut-open"]));

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
  // the watch is a polled surface: an app that died mid-watch is BLOCKED, never a
  // product FAIL on a row that never arrived (review r1 R1-13)
  const watch = await watchRowStatesOrBlocked(ctx, session, doc.id, { until: faulted, timeout: OFFLINE_DOWNLOAD_TIMEOUT_MS });
  // the faulted reading is taken WHILE the fault is still armed, before the rule is
  // cleared and the retry runs: "no partial ready record while faulted" needs it
  // (review r1 R1-14)
  const faultedState = collectOfflineState(storeArgs(ctx, [doc.id]));
  const faultedLog = await ctx.proxyLog();
  const faultedDownloads = downloadRequests(faultedLog, doc.id).length;
  await ctx.clearRules();
  const retry = await downloadNow(session, doc.id);
  const recoveredRow = await awaitRowState(ctx, session, doc.id, recovered);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: faultedState, after });
  // the declared S3 shot, captured as its own assertion: a declared shot that did
  // not capture FAILs, and one that failed because the app died is BLOCKED (R1-11)
  const shots = await captureRowShots(ctx, session, { s3: true });
  const delta = storeDelta(before, after);
  // the verified copy only exists once the retry committed it: while the fault was
  // armed the committed generation was absent, so the faulted reading differs from
  // the recovered one (a positive store invariant, not a claim about ciphertext we
  // cannot decrypt - review r1 R1-14)
  // R2-14: only the TARGET's library records count - a blob committed while the fault
  // was armed, or a sync-store record added beside the retry, says nothing about it
  const faultedBlobs = libraryBlobs(faultedState, [doc.id]);
  const afterBlobs = libraryBlobs(after, [doc.id]);
  const faultedBlobNames = new Map(faultedBlobs.map((record) => [record.name, record.sha256]));
  const gainedBlobs = afterBlobs.filter((record) => faultedBlobNames.get(record.name) !== record.sha256);
  const pinAfter = pinRecordNames([doc.id]).every((name) => after.library.some((record) => record.name === name));
  const libraryAdded = delta.added.filter((key) => key.startsWith("library/"));
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("row_faulted", faulted.join("|"), watch.states.join(" → ") || "(no row seen)", Boolean(watch.found)),
      assertion("never_ready_while_faulted", `never ${recovered.join("|")}`, watch.states.join(" → ") || "(no row seen)", neverReady ? !watch.states.includes("ready") : true),
      // the injected reset really happened: the rule's own log line, not a row state
      // another error could also produce (review r1 R1-14)
      ruleHitAssertion("fault_rule_hit", faultedLog, "cut-download", { documentId: doc.id, status: "reset" }),
      assertion("faulted_before_retry", ">= 1 download while faulted", faultedDownloads, faultedDownloads >= 1),
      resultAssertion("retry_accepted", retry),
      assertion("row_recovered", recovered.join("|"), recoveredRow?.state ?? "never", Boolean(recoveredRow)),
      offlineBoolAssertion(ctx, "capability_on", "capabilityOn", (await offlineSnapshot(session))?.capabilityOn === true),
      // the proxy count reads its own namespace (expect.proxyLog), never expect.offline (review r1 R1-1)
      countAssertion(ctx, "download_requests", "downloadRequestsMin", downloadRequests(log, doc.id).length),
      assertion("store_gained_the_pinned_copy", ">= 1 library record", libraryAdded.length, libraryAdded.length >= 1),
      assertion("no_ready_copy_while_faulted", "0 committed target blob while the fault is armed", faultedBlobs.length, faultedBlobs.length === 0),
      assertion("recovery_adds_target_records", "the target's pin row and >= 1 new blob after the retry", `pin=${pinAfter} newBlobs=${gainedBlobs.length}`, pinAfter && gainedBlobs.length >= 1),
      ...shots,
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
  const refusals = ctx.expect.offline("openRefusalCodes");
  const recoveredStates = ctx.expect.offline("recoveredStates");
  const first = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const before = collectOfflineState(storeArgs(ctx, [doc.id]));
  await ctx.close(session);
  const tampered = tamperLibraryBlobs(libraryStoreDir(ctx.userDataDir(), ctx.deploymentId(), ctx.tenant.app.userId), { documentIds: [doc.id] });
  const second = await ctx.launch({ requireSignIn: false });
  const signedIn = await ctx.waitSignedIn(second);
  const identity = await signedInAsAssertion(second, "relaunched_as_account_a", ctx.tenant.app);
  // "never served from a bad cache" is only reachable through the cache open path:
  // fork api.ts `open` tries the server first and uses the cache on a network error
  // only, and `openCached` is where the bytes are verified (manager.ts:1256-1291).
  // The content route is cut BEFORE the open so the open has nowhere else to go.
  await armOpenCut(ctx);
  const boundary = (await ctx.proxyLog()).length;
  const answered = await requireAnsweredSnapshot(ctx, second, "snapshot_before_open", { documentId: doc.id });
  const opened = await offlineOpen(second, doc.id);
  const row = await awaitRowState(ctx, second, doc.id, [...accepts, ...neverStates]);
  const openLog = (await ctx.proxyLog()).slice(boundary);
  const afterOpen = collectOfflineState(storeArgs(ctx, [doc.id]));
  // S11 comes from the refused open, so it is grabbed before anything else moves
  const shots = await captureRowShots(ctx, second, { s11: true, s3: true });
  const stillTampered = afterOpen.library.filter((record) => tampered.some((was) => was.name === record.name && was.sha256 === record.sha256));
  const servedTampered = opened?.ok === true || (row?.state === "ready" && stillTampered.length > 0);
  // recovery is its own claim, with its own evidence: the network is back, the app
  // downloads again, and the bytes under the row are no longer the tampered ones
  const retryBoundary = (await ctx.proxyLog()).length;
  await ctx.clearRules();
  const retry = await downloadNow(second, doc.id);
  const recovery = await awaitRowState(ctx, second, doc.id, recoveredStates);
  const log = await ctx.proxyLog();
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  writeStoreEvidence(ctx.runDirOut(), { before, faulted: afterOpen, after });
  const replaced = after.library.filter((record) => tampered.some((was) => was.name === record.name && was.sha256 === record.sha256));
  // R2-1: the recovery is a successful upstream download AFTER the retry boundary and a
  // committed pin plus a replacement ciphertext blob (a hash that is not a tampered one)
  const recoveryDownloads = upstreamDownloads(log.slice(retryBoundary), doc.id).filter((entry) => entry.status === 200);
  const afterBlobs = libraryBlobs(after, [doc.id]);
  const replacementBlobs = afterBlobs.filter((record) => !tampered.some((was) => was.name === record.name && was.sha256 === record.sha256));
  const pinCommitted = pinRecordNames([doc.id]).every((name) => after.library.some((record) => record.name === name));
  const copies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [ctx.tenant.app.userId] });
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", first),
      assertion("first_launch_ready", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      preStoreAssertion(before, doc.id),
      assertion("blobs_tampered", ">= 1 ciphertext record", tampered.length, tampered.length >= 1),
      assertion("relaunch_signed_in", "signed in", signedIn ? "signed in" : "not signed in", Boolean(signedIn)),
      identity,
      ...(answered.failure ? [answered.failure] : []),
      // the open path really was cut: the rule's own log line (positive evidence)
      ruleHitAssertion("open_path_cut", openLog, "cut-open", { documentId: doc.id }),
      // only an actual refusal naming the corrupt copy counts: no API, a thrown call or
      // an unrelated code is NOT a refusal (review r1 R1-5)
      assertion("open_refused_as_corrupt", refusals.join("|"), opened?.ok === true ? "opened" : opened?.code ?? "no answer", opened?.ok === false && refusals.includes(opened?.code)),
      assertion("row_state_after_open", accepts.join("|"), row?.state ?? "no row", Boolean(row?.state) && accepts.includes(row.state)),
      assertion("never_served_tampered_bytes", "no open and no ready row over tampered ciphertext", servedTampered ? "served" : "not served", !servedTampered),
      // the verification dropped the bad copy: its tampered ciphertext is no longer in the store
      assertion("tampered_ciphertext_dropped", "0 record still carrying a tampered hash", stillTampered.length, stillTampered.length === 0),
      offlineCountAssertion(ctx, "no_plaintext_copy_materialized", "plaintextCopies", copies.length),
      resultAssertion("retry_accepted", retry),
      assertion("row_recovered", recoveredStates.join("|"), recovery?.state ?? "never", Boolean(recovery)),
      assertion("recovered_bytes_are_not_the_tampered_ones", "0 record still carrying a tampered hash", replaced.length, replaced.length === 0),
      assertion("recovery_downloaded_target", ">= 1 successful upstream download of the target after the retry", recoveryDownloads.length, recoveryDownloads.length >= 1),
      assertion("recovered_committed_pin_and_blob", "the committed pin row and >= 1 replacement ciphertext blob", `pin=${pinCommitted} replacementBlobs=${replacementBlobs.length}`, pinCommitted && replacementBlobs.length >= 1),
      countAssertion(ctx, "download_after_tamper", "downloadRequestsMin", downloadRequests(log, doc.id).length),
      ...shots,
      ...noWriteAssertions(ctx, log, doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

/** `N row(s)` plus the sha256 of each row's name - never a name (R2-10). */
const nameDigest = (rows) =>
  rows.length === 0 ? "0 row(s)" : `${rows.length} row(s), sha256(name) ${rows.map((row) => createHash("sha256").update(String(row.name ?? ""), "utf8").digest("hex")).join(",")}`;

// ---- FL-07: sign-out A, sign-in B ------------------------------------------------
async function fl07(ctx) {
  const blocker = await withOfflineCapability(ctx);
  if (blocker) return { documentId: null, assertions: [], blocker };
  const { doc, session } = await offlineFresh(ctx);
  const a = ctx.tenant.app;
  const b = ctx.tenant.foreign;
  const pinned = await pinDocument(session, { documentId: doc.id, workspaceId: ctx.tenant.workspaceId });
  const ready = await awaitRowState(ctx, session, doc.id, ctx.expect.offline("firstLaunchStates"));
  const asA = await signedInAsAssertion(session, "signed_in_as_account_a", a);
  const before = collectOfflineState(storeArgs(ctx, [doc.id], a.userId));
  const preStore = preStoreAssertion(before, doc.id);
  await signOut(session);
  const facts = await signedOutFacts(session);
  const signedOutRead = await requireAnsweredSnapshot(ctx, session, "snapshot_while_signed_out");
  const afterSignOut = collectOfflineState(storeArgs(ctx, [doc.id], a.userId));
  // the S3 shot while A is signed out: the count-only surface that must keep no
  // document name. There is no S11 lock path without a session (the product shows
  // the signed-out summary, not a lock panel), so the row declares the S3 shot only.
  const shots = await captureRowShots(ctx, session, { s3: true });
  await ctx.signInAs(session, b);
  const asB = await signedInAsAssertion(session, "signed_in_as_account_b", b);
  const bRead = await requireAnsweredSnapshot(ctx, session, "snapshot_as_account_b");
  const bRows = rowsOf(bRead.snapshot);
  const bCopies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [b.userId] });
  const aCopies = listPlaintextCopies(ctx.userDataDir(), ctx.deploymentId(), { accountIds: [a.userId] });
  const after = collectOfflineState(storeArgs(ctx, [doc.id], a.userId));
  writeStoreEvidence(ctx.runDirOut(), { before, after });
  // A's own ciphertext records must be gone from A's scope: the sign-out boundary wipes it
  const aRecordsLeft = afterSignOut.library.filter((record) => before.library.some((was) => was.name === record.name)).length;
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("ready_before_sign_out", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      asA,
      preStore,
      offlineBoolAssertion(ctx, "account_a_locked_while_signed_out", "accountALockedWhileSignedOut", facts?.status === "signed_out"),
      offlineBoolAssertion(ctx, "account_a_scope_wiped", "accountAScopeWiped", aRecordsLeft === 0),
      offlineCountAssertion(ctx, "account_a_plaintext_copies", "plaintextCopies", aCopies.length),
      ...(signedOutRead.failure ? [signedOutRead.failure] : []),
      offlineBoolAssertion(ctx, "signed_out_surface_keeps_no_name", "signedOutKeepsNoName", signedOutRead.answered && rowsOf(signedOutRead.snapshot).length === 0),
      asB,
      assertion("account_b_is_not_account_a", "different accounts", `${a.userId === b.userId ? "same" : "different"}`, a.userId !== b.userId),
      ...(bRead.failure ? [bRead.failure] : []),
      offlineCountAssertion(ctx, "account_b_rows", "accountBRows", bRows.length),
      offlineCountAssertion(ctx, "account_b_copies", "accountBCopies", bCopies.length),
      // count + sha256 of each name only: a privacy failure must not write the name it detects (R2-10)
      assertion("account_b_sees_no_document_name", "0 rows naming a document", nameDigest(bRows), bRead.answered && bRows.length === 0),
      ...shots,
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
  const preStore = preStoreAssertion(before, doc.id);
  const aPinRecords = before.pinRecords.filter((name) => before.library.some((record) => record.name === name)).length;
  await ctx.close(session);
  const bSession = await ctx.launch({ requireSignIn: false, deploymentId: FL08_DEPLOYMENT_B });
  // B must really be the effective deployment: a saved deployment profile beats
  // the env (fork deployment.ts resolveDeploymentProfile), so env alone proves nothing
  const effective = await deploymentEvidence(bSession, ctx.userDataDir());
  const bRead = await requireAnsweredSnapshot(ctx, bSession, "snapshot_on_deployment_b");
  const bRows = rowsOf(bRead.snapshot);
  // deployment B has no account of its own in scope (nobody signed in on it), so every
  // account folder of that deployment is scanned; names are hashes, never the name itself
  const bCopies = listPlaintextCopies(ctx.userDataDir(), FL08_DEPLOYMENT_B);
  const after = collectOfflineState(storeArgs(ctx, [doc.id]));
  const delta = storeDelta(before, after);
  writeStoreEvidence(ctx.runDirOut(), { before, after });
  // S3 on deployment B: the empty library the row claims, captured as evidence
  const shots = await captureRowShots(ctx, bSession, { s3: true });
  return {
    documentId: doc.id,
    assertions: [
      resultAssertion("pin_accepted", pinned),
      assertion("ready_before_switch", ctx.expect.offline("firstLaunchStates").join("|"), ready?.state ?? "never", Boolean(ready)),
      preStore,
      assertion("deployment_b_is_effective", `${FL08_DEPLOYMENT_B} and no saved profile`, `env=${effective.env ?? "unset"} savedProfile=${effective.savedProfile}`, effective.env === FL08_DEPLOYMENT_B && effective.savedProfile === false),
      ...(bRead.failure ? [bRead.failure] : []),
      offlineCountAssertion(ctx, "deployment_b_rows", "deploymentBRows", bRows.length),
      offlineCountAssertion(ctx, "deployment_b_copies", "deploymentBCopies", bCopies.length),
      offlineCountAssertion(ctx, "deployment_a_rows", "deploymentARows", aPinRecords),
      // every registered store of A's scope (library, drafts, feed cursors, doc index,
      // leases, ...) is compared by name and hash, not the library array alone
      offlineBoolAssertion(ctx, "deployment_a_scope_unchanged", "deploymentAScopeUnchanged", delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0),
      assertion("deployment_b_library_empty", "0 rows on deployment B", bRows.length, bRead.answered && bRows.length === 0),
      ...shots,
      ...noWriteAssertions(ctx, await ctx.proxyLog(), doc.id),
      await deltaAssertion(ctx, doc.id),
    ],
  };
}

export const OFFLINE_DRIVERS = {
  "FL-01": (ctx) => runGuarded(ctx, fl01),
  "FL-03": (ctx) => runGuarded(ctx, fl03),
  "FL-07": (ctx) => runGuarded(ctx, fl07),
  "FL-08": (ctx) => runGuarded(ctx, fl08),
};

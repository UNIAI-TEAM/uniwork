// Test doubles for the FL drivers (G7-03b, UNI-1382; review r1 R1-15): a fake
// app, proxy and store that let the REGISTERED driver of a row run on its REAL
// cases.json row without Electron. The page functions the drivers hand to
// `session.shell.evaluate` run here in Node against a fake `window`, and the
// store is a real scratch userData with the fork's own layout, so the collector,
// the tamper and the deltas are the production code.
//
// The fake product models what the verdicts depend on: the offline library's
// rows, the cache verification on a cut-network open, the sign-out wipe and the
// deployment scope. A test changes ONE behavior (`world.product.*`) to make the
// product wrong, and the driver must say so - or say BLOCKED when the app died.
// What this does NOT prove is the real Electron/fork boundary: that stays with
// the cloud run.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  S11_LOCK_SELECTOR, S3_PANEL_SELECTOR, S3_TAB_SELECTOR, copiesRootDir, leaseStoreDir, libraryStoreDir, recordName,
} from "./app-case-drivers-offline.mjs";
import { FAKETIME_CANDIDATES, faketimeEnv } from "./app-offline-env.mjs";
import { caseExpect } from "./case-expect.mjs";
import { loadFaultCases, renderCaseRules } from "./server-cases-lib.mjs";

export const ACCOUNT_A = "01JACCOUNTAAAAAAAAAAAAAAAA";
export const ACCOUNT_B = "01JACCOUNTBBBBBBBBBBBBBBBB";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The real row of cases.json: the driver is tested against the numbers it ships with. */
export const realRow = (id) => loadFaultCases().cases.find((row) => row.id === id);

/**
 * One fake run. `product` is the behavior a test may replace; the defaults are a
 * CORRECT product for FL-01/03/07/08 (a pin downloads through the proxy, a cut
 * download is `interrupted`, a tampered blob is `corrupt` on a cache open, a
 * sign-out wipes the account scope, B's scope is empty).
 */
export function createWorld(rowId, { deployment = "default", dead = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fl-world-"));
  const runDir = join(root, "run");
  mkdirSync(runDir, { recursive: true });
  const userData = join(root, "userdata");
  const world = {
    root,
    userData,
    runDir,
    deployment,
    alive: !dead,
    row: realRow(rowId),
    signedInAs: ACCOUNT_A,
    // a saved deployment profile beats the env (fork deployment.ts): a test sets it to prove the env alone is not enough
    savedProfile: false,
    snapshotWorks: true,
    // the rows the library shows, by document id: `{state, name, lockReason?}`
    rows: new Map(),
    // what is in the store: record name -> bytes (ciphertext), by library scope
    pristine: new Map(),
    rules: [],
    ruleCounters: new Map(),
    log: [],
    sessions: [],
    launches: [],
    // W2 faults: a lease per document (short = served by a rewrite_json rule), the disk, the org revoke, the keystore and the latched clock rollback
    leases: new Map(),
    leaseSeq: 0,
    expireAfterPolls: 2,
    diskFull: false,
    revoked: false,
    revokedSeen: new Set(),
    revokeFails: false,
    keyringLocked: false,
    // a process that started while the keystore was locked keeps failing until it is relaunched
    keyringSticky: false,
    keyringBroken: false,
    rollbackLatched: false,
    // the VM: a runner that HAS tmpfs, libfaketime and the keyring control channel, until a test takes one away
    tmpfsMountable: true,
    mountFails: false,
    faketimeInstalled: true,
    keyringControl: true,
    keyringLockFails: false,
    fillLeavesBytes: null,
    visible: new Set(),
    tabSelected: false,
    docSeq: 0,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
  const libraryDir = (account = ACCOUNT_A, dep = world.deployment) => libraryStoreDir(userData, dep, account);
  const writeRecord = (dir, key, bytes) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, recordName(key)), bytes);
    return recordName(key);
  };
  world.writeRecord = writeRecord;
  world.libraryDir = libraryDir;

  const matchingRule = (method, path) =>
    world.rules.find((rule) => {
      if (rule.match.method && rule.match.method !== method) return false;
      if (!new RegExp(rule.match.path).test(path)) return false;
      const seen = (world.ruleCounters.get(rule.id) ?? 0) + 1;
      world.ruleCounters.set(rule.id, seen);
      return rule.match.nth === undefined || rule.match.nth === seen;
    }) ?? null;

  /** One GET of the content route through the fake proxy: a hit resets, else the upstream answers 200. */
  const download = (documentId) => {
    const path = `/api/v1/documents/${documentId}/download`;
    const rule = matchingRule("GET", path);
    world.log.push({ method: "GET", path, status: rule ? "reset" : 200, ruleId: rule?.id ?? null });
    return !rule;
  };
  world.download = download;

  const writeLibrary = (documentId, account = world.signedInAs ?? ACCOUNT_A) => {
    const dir = libraryDir(account);
    const names = [
      writeRecord(dir, "index", Buffer.from(`index-${documentId}`)),
      writeRecord(dir, `pin/${documentId}`, Buffer.from(`pin-${documentId}`)),
      writeRecord(dir, `blob/${documentId}/g1/main`, Buffer.from(`CIPHERTEXT-BYTES-OF-${documentId}-${"x".repeat(64)}`)),
    ];
    for (const name of names) world.pristine.set(name, sha(readFileSync(join(dir, name))));
  };
  world.writeLibrary = writeLibrary;

  const blobNames = (documentId, account = ACCOUNT_A) => [recordName(`blob/${documentId}/g1/main`)].filter((name) => readdirSync(libraryDir(account)).includes(name));

  /**
   * The lease route through the fake proxy: a reset cuts it, a revoked lease answers 403, a `rewrite_json`
   * rule serves a SHORT lease (it lapses once nothing can renew it), anything else is a normal 200 that also
   * lifts a latched clock rollback. Every grant moves the document's lease record, so "the lease was not
   * extended" is a real store comparison.
   */
  const leasePut = (documentId) => {
    const path = `/api/v1/documents/${documentId}/office/offline-lease`;
    const rule = matchingRule("PUT", path);
    if (rule?.action.type === "reset") {
      world.log.push({ method: "PUT", path, status: "reset", ruleId: rule.id });
      return "cut";
    }
    if (world.revoked) {
      world.log.push({ method: "PUT", path, status: 403, ruleId: rule?.id ?? null });
      return "revoked";
    }
    world.log.push({ method: "PUT", path, status: 200, ruleId: rule?.id ?? null });
    world.leases.set(documentId, { short: rule?.action.type === "rewrite_json", polls: 0 });
    world.rollbackLatched = false;
    writeRecord(world.leaseDir(), `lease/${documentId}`, Buffer.from(`lease-${documentId}-${++world.leaseSeq}`));
    return "granted";
  };
  world.leasePut = leasePut;
  const leaseCut = () => world.rules.some((rule) => rule.id === "cut-lease" || rule.id === "cut-network");
  const keystoreDown = () => world.keyringLocked || world.keyringBroken;

  /** the row the product shows: the stored row with the lease / clock / revoke overlay (null while the keystore is down) */
  const viewOf = (documentId, row) => {
    if (keystoreDown()) return null;
    if (world.revokedSeen.has(documentId)) return { documentId, ...row, state: "revoked", lockReason: "permission_revoked" };
    if (world.rollbackLatched && row.state === "ready") return { documentId, ...row, state: "locked", lockReason: "clock_rollback" };
    const lease = world.leases.get(documentId);
    if (lease?.short && leaseCut() && row.state === "ready") {
      lease.polls += 1;
      if (lease.polls > world.expireAfterPolls) return { documentId, ...row, state: "lease-expired", lockReason: "lease_expired" };
    }
    return { documentId, ...row };
  };

  /** a pin that met a full disk: only the pin row (and the index listing it) lands, never a blob */
  const writePinOnly = (documentId, account = world.signedInAs ?? ACCOUNT_A) => {
    const dir = libraryDir(account);
    writeRecord(dir, "index", Buffer.from(`index-${documentId}`));
    writeRecord(dir, `pin/${documentId}`, Buffer.from(`pin-${documentId}`));
  };

  world.product = {
    /** pin: the download goes through the proxy; a cut one is `interrupted`, a full disk `disk-full`, else the copy is written and `ready` */
    pin: ({ documentId }) => {
      if (keystoreDown()) return { ok: false, code: "keystore_locked", lockReason: "keystore_locked" };
      if (!download(documentId)) {
        world.rows.set(documentId, { state: "interrupted", name: "doc" });
        return { ok: true };
      }
      if (world.diskFull) {
        writePinOnly(documentId);
        world.rows.set(documentId, { state: "disk-full", name: "doc" });
        return { ok: true };
      }
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      leasePut(documentId);
      return { ok: true };
    },
    downloadNow: (documentId) => {
      if (keystoreDown()) return { ok: false, code: "keystore_locked", lockReason: "keystore_locked" };
      if (!download(documentId)) {
        world.rows.set(documentId, { state: "interrupted", name: "doc" });
        return { ok: false, code: "interrupted" };
      }
      if (world.diskFull) {
        world.rows.set(documentId, { state: "disk-full", name: "doc" });
        return { ok: false, code: "store_full" };
      }
      const lease = leasePut(documentId);
      if (lease === "revoked") {
        world.revokedSeen.add(documentId);
        return { ok: false, code: "revoked", lockReason: "permission_revoked" };
      }
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      return { ok: true };
    },
    /** a cut content route sends the open to the cache, which checks keystore, revoke, clock, lease and bytes in turn */
    open: (documentId) => {
      if (download(documentId)) return { ok: true };
      const refuse = (code, lockReason) => {
        world.visible.add(S11_LOCK_SELECTOR);
        return { ok: false, code, ...(lockReason ? { lockReason } : {}) };
      };
      if (keystoreDown()) return refuse("keystore_locked", "keystore_locked");
      const row = world.rows.get(documentId);
      if (!row) return { ok: false, code: "not_pinned" };
      const view = viewOf(documentId, row);
      if (view?.state === "revoked") return refuse("revoked", "permission_revoked");
      if (view?.lockReason === "clock_rollback") return refuse("lease_unusable", "clock_rollback");
      if (view?.state === "lease-expired") return refuse("lease_unusable", "lease_expired");
      const names = blobNames(documentId);
      const tampered = names.some((name) => sha(readFileSync(join(libraryDir(), name))) !== world.pristine.get(name));
      if (tampered || names.length === 0) {
        for (const name of names) rmSync(join(libraryDir(), name), { force: true });
        world.rows.set(documentId, { state: "corrupt", name: "doc" });
        return refuse("corrupt");
      }
      return { ok: true };
    },
    /** sign-out wipes the account's offline scope and the rows */
    signOut: () => {
      rmSync(libraryDir(), { recursive: true, force: true });
      world.rows.clear();
      world.signedInAs = null;
    },
    /** what the rows are after a launch with `deployment`: another deployment is its own, empty scope */
    rowsFor: (dep) => (dep === "default" ? [...world.rows.entries()].map(([documentId, row]) => viewOf(documentId, row)).filter(Boolean) : []),
  };

  /**
   * The runner VM the W2 drivers see (`ctx.vm`): every probe answers like a VM that has the tool, and a test
   * flips one switch (`tmpfsMountable`, `faketimeInstalled`, `keyringControl`, ...) to take it away.
   */
  world.vmCalls = [];
  const faketimeLibrary = FAKETIME_CANDIDATES[0];
  world.vm = {
    probeTmpfsMount: () => (world.tmpfsMountable ? { ok: true } : { ok: false, line: "sudo -n true exited 1: a password is required" }),
    mountTmpfs: (dir, mb) => {
      world.vmCalls.push(["mount", dir, mb]);
      return world.mountFails ? { ok: false, line: `mount -t tmpfs -o size=${mb}m ${dir} exited 32: permission denied` } : { ok: true };
    },
    unmountTmpfs: (dir) => {
      world.vmCalls.push(["unmount", dir]);
      return { ok: true };
    },
    fillToLeave: (dir, leave) => {
      world.vmCalls.push(["fill", dir, leave]);
      world.diskFull = true;
      return { path: join(dir, ".fl02-filler"), freeBefore: 400 * 1024 * 1024, freeAfter: world.fillLeavesBytes ?? leave };
    },
    releaseFill: (path) => {
      world.vmCalls.push(["release", path]);
      world.diskFull = false;
    },
    sparseFill: (scopeDir, budget, leave) => {
      world.vmCalls.push(["sparse", scopeDir, budget, leave]);
      world.diskFull = true;
      return { path: join(scopeDir, ".fl02-sparse-filler"), apparentBytes: budget - leave };
    },
    findFaketime: () => (world.faketimeInstalled ? { path: faketimeLibrary } : { line: "libfaketime is not installed on the runner VM (apt-get install -y libfaketime)" }),
    faketimeEnv,
    keyring: {
      available: () => (world.keyringControl ? null : "APP_KEYRING_CTL is not set: run the runner as `APP_KEYRING_CONTROL=1 dbus-run-session -- bash app-keyring.sh`"),
      lock: () => {
        world.vmCalls.push(["keyring", "lock"]);
        if (world.keyringLockFails) return { ok: false, line: "the keyring wrapper answered lock with: fail: the collection is still unlocked after Lock" };
        world.keyringLocked = true;
        return { ok: true };
      },
      unlock: () => {
        world.vmCalls.push(["keyring", "unlock"]);
        world.keyringLocked = false;
        return { ok: true };
      },
    },
  };

  let currentDeployment = deployment;
  world.currentDeployment = () => currentDeployment;

  const window = {
    uniworkSyncCenter: {
      getSnapshot: async () => {
        if (!world.snapshotWorks) throw new Error("getSnapshot rejected");
        return {
          offline: { capabilityOn: true, rows: world.product.rowsFor(currentDeployment) },
          header: { status: world.signedInAs ? "signed_in" : "signed_out" },
          signedOut: { lockedCount: 0 },
        };
      },
      offlinePin: async (input) => world.product.pin(input),
      offlineDownloadNow: async (id) => world.product.downloadNow(id),
      offlineOpen: async (id) => world.product.open(id),
    },
    aiOffice: {
      accountStatus: async () => ({ loggedIn: Boolean(world.signedInAs), state: world.signedInAs ? "signed-in" : "signed-out", profile: world.signedInAs ? { accountId: world.signedInAs } : undefined }),
      accountLogout: async () => world.product.signOut(),
    },
    dispatchEvent: () => true,
  };
  world.window = window;

  /** runs a page function against the fake window (and the fake DOM the S3 helpers poll) */
  const inPage = async (fn, arg) => {
    const previous = { window: globalThis.window, document: globalThis.document, CustomEvent: globalThis.CustomEvent };
    globalThis.window = window;
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    globalThis.document = {
      querySelector: (selector) => (selector === S3_TAB_SELECTOR && world.tabAvailable !== false ? { getAttribute: () => (world.tabSelected ? "true" : "false") } : null),
    };
    try {
      return await fn(arg);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  };

  const makeSession = (options = {}) => {
    const dep = options.deploymentId ?? "default";
    const session = {
      dead: false,
      // libfaketime's FAKETIME=-<N>m, as the launch env carried it
      clockBehindMs: (() => {
        const match = /^-(\d+)m$/.exec(options.extraEnv?.FAKETIME ?? "");
        return match ? Number(match[1]) * 60_000 : 0;
      })(),
      userDataDir: userData,
      deploymentId: dep,
      app: {
        evaluate: async (fn) => {
          if (!world.alive) throw new Error("Target closed");
          const saved = process.env.UNIWORK_DEPLOYMENT_ID;
          const realNow = Date.now;
          Date.now = () => realNow() - session.clockBehindMs;
          // an app launched with a deployment id reads it from its env (and a saved profile beats it)
          process.env.UNIWORK_DEPLOYMENT_ID = world.effectiveDeployment ?? dep;
          try {
            return await fn({ dialog: {}, safeStorage: {} });
          } finally {
            Date.now = realNow;
            if (saved === undefined) delete process.env.UNIWORK_DEPLOYMENT_ID;
            else process.env.UNIWORK_DEPLOYMENT_ID = saved;
          }
        },
        close: async () => {},
      },
      shell: {
        evaluate: async (fn, arg) => {
          if (!world.alive) throw new Error("Target closed");
          return inPage(fn, arg);
        },
        locator: () => ({
          first() { return this; },
          waitFor: async () => { if (world.tabAvailable === false || !world.alive) throw new Error("tab never visible"); },
          getAttribute: async () => (world.tabSelected ? "true" : "false"),
          click: async () => { world.tabSelected = true; world.visible.add(S3_PANEL_SELECTOR); },
        }),
        waitForFunction: async (fn, arg) => { if (!(await inPage(fn, arg))) throw new Error("timeout"); },
        waitForSelector: async (selector) => { if (!world.alive || !world.visible.has(selector)) throw new Error(`selector ${selector} never appeared`); },
        screenshot: async () => Buffer.from("PNG"),
      },
    };
    currentDeployment = dep;
    // the product sees the wall clock go back across a restart and locks; a process born on a locked keystore stays broken
    if (session.clockBehindMs > 0) world.rollbackLatched = true;
    world.keyringBroken = world.keyringSticky && world.keyringLocked;
    world.sessions.push(session);
    return session;
  };

  const ctx = {
    row: world.row,
    expect: caseExpect(world.row, null),
    tenant: { apiOrigin: "http://d", workspaceId: "01JWORKSPACE0000000000000", app: { userId: ACCOUNT_A }, foreign: { userId: ACCOUNT_B } },
    userDataDir: () => userData,
    deploymentId: () => "default",
    runDirOut: () => runDir,
    artifactPath: (name) => join(runDir, name),
    appAlive: async () => world.alive,
    ensureAdmin: async () => null,
    setOfflineLibrary: async () => {},
    newDocument: async () => ({ id: `01JDOC${String(++world.docSeq).padStart(20, "0")}` }),
    launch: async (options = {}) => {
      world.launches.push(options);
      if (world.launchFails) throw new Error("electron did not start");
      return makeSession(options);
    },
    waitSignedIn: async () => (world.signedInAs ? { loggedIn: true } : null),
    signInAs: async (_session, account) => { world.signedInAs = world.signInYields ?? account.userId; },
    caseRules: (ids) => renderCaseRules({ ...world.row, proxyRules: world.row.proxyRules.filter((r) => ids.includes(r.id)) }, {}),
    setRules: async (rules) => { world.rules = rules; world.ruleCounters.clear(); },
    clearRules: async () => { world.rules = []; },
    proxyLog: async () => world.log.map((entry) => ({ ...entry })),
    versionDelta: async () => 0,
    vm: world.vm,
    // the admin CLI on D: null = revoked, else the line the runner would report
    revokeOfflineLeases: async () => {
      world.vmCalls.push(["revoke"]);
      if (world.revokeFails) return "uniwork-admin revoke-offline-leases exited 1: no organization";
      world.revoked = true;
      return null;
    },
  };
  world.ctx = ctx;
  world.makeSession = makeSession;
  world.copiesDir = (account = ACCOUNT_A, dep = world.deployment) => join(copiesRootDir(userData, dep), account);
  world.syncStoreDir = (store, account = ACCOUNT_A) => join(userData, "uniwork-sync", "store", world.deployment, account, store);
  world.leaseDir = (account = ACCOUNT_A) => leaseStoreDir(userData, world.deployment, account);
  return world;
}

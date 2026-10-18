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

  world.product = {
    /** pin: the download goes through the proxy; a cut one is `interrupted`, else the copy is written and `ready` */
    pin: ({ documentId }) => {
      if (!download(documentId)) {
        world.rows.set(documentId, { state: "interrupted", name: "doc" });
        return { ok: true };
      }
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      return { ok: true };
    },
    downloadNow: (documentId) => {
      if (!download(documentId)) {
        world.rows.set(documentId, { state: "interrupted", name: "doc" });
        return { ok: false, code: "interrupted" };
      }
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      return { ok: true };
    },
    /** a cut content route sends the open to the cache, which verifies the bytes it finds */
    open: (documentId) => {
      if (download(documentId)) return { ok: true };
      const row = world.rows.get(documentId);
      if (!row) return { ok: false, code: "not_pinned" };
      const names = blobNames(documentId);
      const tampered = names.some((name) => sha(readFileSync(join(libraryDir(), name))) !== world.pristine.get(name));
      if (tampered || names.length === 0) {
        for (const name of names) rmSync(join(libraryDir(), name), { force: true });
        world.rows.set(documentId, { state: "corrupt", name: "doc" });
        world.visible.add(S11_LOCK_SELECTOR);
        return { ok: false, code: "corrupt" };
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
    rowsFor: (dep) => (dep === "default" ? [...world.rows.entries()].map(([documentId, row]) => ({ documentId, ...row })) : []),
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
      userDataDir: userData,
      deploymentId: dep,
      app: {
        evaluate: async (fn) => {
          if (!world.alive) throw new Error("Target closed");
          const saved = process.env.UNIWORK_DEPLOYMENT_ID;
          // an app launched with a deployment id reads it from its env (and a saved profile beats it)
          process.env.UNIWORK_DEPLOYMENT_ID = world.effectiveDeployment ?? dep;
          try {
            return await fn({ dialog: {}, safeStorage: {} });
          } finally {
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
  };
  world.ctx = ctx;
  world.makeSession = makeSession;
  world.copiesDir = (account = ACCOUNT_A, dep = world.deployment) => join(copiesRootDir(userData, dep), account);
  world.leaseDir = (account = ACCOUNT_A) => leaseStoreDir(userData, world.deployment, account);
  return world;
}

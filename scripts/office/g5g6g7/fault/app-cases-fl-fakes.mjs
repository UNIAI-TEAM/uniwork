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
import { FAKETIME_CANDIDATES, faketimeEnv, scopeUsageBytes } from "./app-offline-env.mjs";
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
    // the org's offline policy epoch (the revoke CLI bumps it) and how many fresh grants a live session may still take under it
    policyEpoch: 1,
    regrantsLeft: 1,
    // a test turns it on: D refuses every fresh grant (the person lost access), so the live re-grant after a 403 cannot succeed
    regrantRefused: false,
    revokedSeen: new Set(),
    revokeFails: false,
    keyringLocked: false,
    // a process that started while the keystore was locked keeps failing until it is relaunched
    keyringSticky: false,
    keyringBroken: false,
    rollbackLatched: false,
    // a product that extends the lease while the clock is back (a test turns it on)
    extendOnRollback: false,
    // R2-9: time the driver slept (ctx.sleep), the content requests a hold rule keeps, the copies an open tab shows
    sleptMs: 0,
    held: new Map(),
    opened: new Set(),
    // R2-11: cleanup results a test can break
    unmountFails: false,
    releaseFails: false,
    fillThrowsAfterPath: false,
    lockFailsButLocks: false,
    finalUnlockFails: false,
    unlockCalls: 0,
    // the VM: a runner that HAS tmpfs, libfaketime and the keyring control channel, until a test takes one away
    tmpfsMountable: true,
    mountFails: false,
    sparseFails: false,
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
  const downloadPath = (documentId) => `/api/v1/documents/${documentId}/download`;
  const download = (documentId) => {
    const path = downloadPath(documentId);
    const rule = matchingRule("GET", path);
    world.log.push({ method: "GET", path, status: rule ? "reset" : 200, ruleId: rule?.id ?? null });
    return !rule;
  };
  world.download = download;
  /** the same GET, but a `hold` rule keeps it until the driver releases it (the proxy's own behaviour), then the upstream answers 200 */
  const downloadHeld = async (documentId) => {
    const path = downloadPath(documentId);
    const rule = matchingRule("GET", path);
    if (rule?.action.type === "hold") {
      await new Promise((resolve) => world.held.set(rule.id, resolve));
      world.log.push({ method: "GET", path, status: 200, ruleId: rule.id });
      return true;
    }
    world.log.push({ method: "GET", path, status: rule ? "reset" : 200, ruleId: rule?.id ?? null });
    return !rule;
  };

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

  const FULL_LEASE_MS = 24 * 60 * 60 * 1000;
  /**
   * The lease route through the fake proxy: a reset cuts it, a revoked lease answers 403 `offline_lease_revoked`,
   * a `rewrite_json` rule serves a SHORT lease (it projects `lease-expiring` like the fork's < 4 h rule and
   * lapses once nothing can renew it), anything else is a full 24 h grant that also lifts a latched clock
   * rollback. Every grant moves the document's lease record, so "the lease was not extended" is a real store
   * comparison.
   */
  const leasePut = (documentId, fresh = false) => {
    const path = `/api/v1/documents/${documentId}/office/offline-lease`;
    const rule = matchingRule("PUT", path);
    if (rule?.action.type === "reset") {
      world.log.push({ method: "PUT", path, status: "reset", ruleId: rule.id });
      return "cut";
    }
    // a `status` rule answers for D (FL-06 window B: the re-grant is refused too), the logged shape of the proxy's synthetic answer.
    // Only 403 + offline_lease_revoked is the revoke the fork acts on (lease/manager.ts:677-685 revokes on revoked/access_denied
    // only; lease/client.ts:256-260 maps any other answer to server_error): that is "refused". Another non-200 answer is
    // a failed call that leaves the copy as it was, and a 200 answer is a grant like any other.
    if (rule?.action.type === "status" && rule.action.code !== 200) {
      world.log.push({ method: "PUT", path, status: "synthetic", ruleId: rule.id });
      return rule.action.code === 403 && rule.action.body?.error?.code === "offline_lease_revoked" ? "refused" : "failed";
    }
    // a renewal of a lease from an older policy epoch is refused; a fresh grant (the manager's grant(), no lease token) is a new row under the new epoch
    const oldEpoch = (world.leases.get(documentId)?.epoch ?? 1) < world.policyEpoch;
    if (world.revoked && ((!fresh && oldEpoch) || (fresh && (world.regrantsLeft <= 0 || world.regrantRefused)))) {
      world.log.push({ method: "PUT", path, status: 403, ruleId: rule?.id ?? null, errorCode: world.revokeErrorCode ?? "offline_lease_revoked" });
      return "revoked";
    }
    if (world.revoked && fresh && oldEpoch) world.regrantsLeft -= 1;
    world.log.push({ method: "PUT", path, status: 200, ruleId: rule?.id ?? null, policyEpoch: world.grantEpochOverride ?? world.policyEpoch });
    world.revokedSeen.delete(documentId);
    const short = rule?.action.type === "rewrite_json";
    const ttlMs = short ? rule.action.patch.expires_at.now_plus_ms : FULL_LEASE_MS;
    world.leases.set(documentId, { short, ttlMs, grantedAt: Date.now(), grantedSlept: world.sleptMs, polls: 0, expired: false, epoch: world.policyEpoch });
    world.rollbackLatched = false;
    writeRecord(world.leaseDir(), `lease/${documentId}`, Buffer.from(`lease-${documentId}-${++world.leaseSeq}`));
    return "granted";
  };
  world.leasePut = leasePut;
  const leaseCut = () => world.rules.some((rule) => rule.id === "cut-lease" || rule.id === "cut-network");
  const keystoreDown = () => world.keyringLocked || world.keyringBroken;
  /** the lease manager renews only a lease that is due: none yet, expired, latched, or half its TTL gone (the driver's sleeps are the clock) */
  const leaseDue = (documentId) => {
    const lease = world.leases.get(documentId);
    return !lease || lease.expired || world.rollbackLatched || (lease.short && world.sleptMs - lease.grantedSlept >= lease.ttlMs / 2);
  };
  /** what the library's ensureLease reacts to (offline-library/manager.ts:1025-1034): no lease or an expired one; a usable lease, due or not, is left to the manager's own pass */
  const leaseGone = (documentId) => {
    const lease = world.leases.get(documentId);
    return !lease || lease.expired || world.rollbackLatched;
  };
  /**
   * The lease manager's online pass (fork `onOnlinePass` -> `renew()`, lease/manager.ts:818-854): with the network up
   * and a live session it renews every DUE lease. A 403 `offline_lease_revoked` on that renewal re-grants ONCE in the same
   * call (:653-674); a refused re-grant (or any other 403 code) marks the copy revoked. The driver's sleeps are the
   * poll interval: nothing else in the fake can cause a renewal.
   */
  const onlinePass = () => {
    if (leaseCut() || keystoreDown() || !world.signedInAs) return;
    for (const documentId of [...world.leases.keys()]) {
      if (world.revokedSeen.has(documentId) || !world.rows.has(documentId) || !leaseDue(documentId)) continue;
      if (leasePut(documentId) !== "revoked") continue;
      const regrantable = (world.revokeErrorCode ?? "offline_lease_revoked") === "offline_lease_revoked";
      const regrant = regrantable ? leasePut(documentId, true) : "revoked";
      if (regrant === "granted" || regrant === "failed") continue;
      world.revokedSeen.add(documentId);
    }
  };
  world.onlinePass = onlinePass;

  /** the row the product shows: the stored row with the lease / clock / revoke overlay (null while the keystore is down) */
  const viewOf = (documentId, row) => {
    if (keystoreDown()) return null;
    const lease = world.leases.get(documentId);
    const base = {
      documentId,
      version: 1,
      ...row,
      open: world.opened.has(documentId),
      leaseUntil: lease ? new Date(lease.grantedAt + lease.ttlMs).toISOString() : null,
    };
    if (world.revokedSeen.has(documentId)) return { ...base, state: "revoked", lockReason: "permission_revoked" };
    if (world.rollbackLatched && row.state === "ready") return { ...base, state: "locked", lockReason: "clock_rollback" };
    if (lease?.short && row.state === "ready") {
      if (lease.expired) lease.polls = world.expireAfterPolls + 1;
      else if (leaseCut()) lease.polls += 1;
      if (lease.polls > world.expireAfterPolls) {
        lease.expired = true;
        // the tab that already shows the copy locks in place: the lock panel rises with no open call
        if (world.opened.has(documentId) && !world.lockStaysHidden) world.visible.add(S11_LOCK_SELECTOR);
        return { ...base, state: "lease-expired", lockReason: "lease_expired" };
      }
      return { ...base, state: "lease-expiring" };
    }
    return base;
  };

  /** the fork's reservation (manager.ts reserve): the pin row and the index land BEFORE any download */
  const reserve = (documentId, account = world.signedInAs ?? ACCOUNT_A) => {
    const dir = libraryDir(account);
    writeRecord(dir, "index", Buffer.from(`index-${documentId}`));
    writeRecord(dir, `pin/${documentId}`, Buffer.from(`pin-${documentId}`));
  };

  world.product = {
    /** pin: reservation first, then the download through the proxy; a cut one is `interrupted`, a full disk `disk-full`, else the copy is written and `ready` */
    pin: async ({ documentId }) => {
      if (keystoreDown()) return { ok: false, code: "keystore_locked", lockReason: "keystore_locked" };
      // an already pinned document is `pinned` with no request at all (offline-library/manager.ts:893)
      if (world.rows.has(documentId)) return { ok: true };
      // a disk that is already full refuses the reservation itself: that is store_full before any content moved
      if (world.diskFull) return { ok: false, code: "store_full" };
      reserve(documentId);
      if (!(await downloadHeld(documentId))) {
        world.rows.set(documentId, { state: "interrupted", name: "doc" });
        return { ok: true };
      }
      if (world.diskFull) {
        world.rows.set(documentId, { state: "disk-full", name: "doc" });
        return { ok: true };
      }
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      leasePut(documentId, true);
      return { ok: true };
    },
    downloadNow: async (documentId) => {
      if (keystoreDown()) return { ok: false, code: "keystore_locked", lockReason: "keystore_locked" };
      if (!(await downloadHeld(documentId))) {
        world.rows.set(documentId, { state: "interrupted", name: "doc" });
        return { ok: false, code: "interrupted" };
      }
      if (world.diskFull) {
        world.rows.set(documentId, { state: "disk-full", name: "doc" });
        return { ok: false, code: "store_full" };
      }
      // a same-head refresh does not renew a usable lease, due or not (manager.ts:1036-1038): only a missing or expired one is granted again
      if (leaseGone(documentId)) {
        const lease = leasePut(documentId);
        if (lease === "revoked") {
          world.revokedSeen.add(documentId);
          return { ok: false, code: "revoked", lockReason: "permission_revoked" };
        }
      }
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      return { ok: true };
    },
    /** a cut content route sends the open to the cache, which checks keystore, revoke, clock, lease and bytes in turn */
    open: (documentId) => {
      if (download(documentId)) {
        world.opened.add(documentId);
        return { ok: true };
      }
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
      world.opened.add(documentId);
      return { ok: true };
    },
    /** sign-out wipes the account's offline scope and the rows */
    signOut: () => {
      rmSync(libraryDir(), { recursive: true, force: true });
      world.rows.clear();
      world.opened.clear();
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
      return world.unmountFails ? { ok: false, line: `umount -l ${dir} exited 32: target is busy; ${dir} is still a mount point` } : { ok: true };
    },
    fillToLeave: (dir, leave, options = {}) => {
      world.vmCalls.push(["fill", dir, leave]);
      // the real helper tells the caller its path BEFORE the first byte (R2-11)
      options.onPath?.(join(dir, ".fl02-filler"));
      if (world.fillThrowsAfterPath) throw new Error("ENOSPC: no space left on device, write");
      world.diskFull = true;
      return { path: join(dir, ".fl02-filler"), freeBefore: 400 * 1024 * 1024, freeAfter: world.fillLeavesBytes ?? leave };
    },
    releaseFill: (path) => {
      world.vmCalls.push(["release", path]);
      if (world.releaseFails) return { ok: false, line: `the filler ${path} is still there after its removal` };
      world.diskFull = false;
      return { ok: true };
    },
    sparseFill: (scopeDir, budget, leave, options = {}) => {
      world.vmCalls.push(["sparse", scopeDir, budget, leave]);
      const path = join(scopeDir, ".fl02-sparse-filler");
      options.onPath?.(path);
      if (world.sparseFails) throw new Error("EACCES: permission denied, open '.fl02-sparse-filler'");
      world.diskFull = true;
      // sized from the scope's measured usage, like the real helper: the scope ends `leave` bytes under the budget
      const usedBefore = scopeUsageBytes(scopeDir);
      const apparentBytes = Math.max(0, budget - leave - usedBefore);
      return { path, apparentBytes, usedBefore, scopeBytes: usedBefore + apparentBytes };
    },
    findFaketime: () => (world.faketimeInstalled ? { path: faketimeLibrary } : { line: "libfaketime is not installed on the runner VM (apt-get install -y libfaketime)" }),
    faketimeEnv,
    keyring: {
      available: () => (world.keyringControl ? null : "APP_KEYRING_CTL is not set: run the runner as `APP_KEYRING_CONTROL=1 dbus-run-session -- bash app-keyring.sh`"),
      lock: () => {
        world.vmCalls.push(["keyring", "lock"]);
        if (world.keyringLockFails) return { ok: false, line: "the keyring wrapper answered lock with: fail: the collection is still unlocked after Lock" };
        world.keyringLocked = true;
        // the lock took effect but the channel's reply was lost: a lock the row cannot count on, one it must still undo
        if (world.lockFailsButLocks) return { ok: false, line: "the keyring control channel did not answer lock (exit 1): timed out" };
        return { ok: true };
      },
      unlock: () => {
        world.vmCalls.push(["keyring", "unlock"]);
        world.unlockCalls += 1;
        // the first unlock is the row's own; a later one is the cleanup's
        if (world.finalUnlockFails && world.unlockCalls >= 2) return { ok: false, line: "the keyring wrapper answered unlock with: fail: the collection is still locked after unlock" };
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
          // a test may replace the whole slice (malformed shapes) - R2-2
          offline: world.offlineSlice ? world.offlineSlice(currentDeployment) : { capabilityOn: true, rows: world.product.rowsFor(currentDeployment) },
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
        locator: (selector) => ({
          first() { return this; },
          waitFor: async () => { if (world.tabAvailable === false || !world.alive) throw new Error("tab never visible"); },
          getAttribute: async () => (world.tabSelected ? "true" : "false"),
          // a tab whose selection never takes (world.selectionFails) leaves a stale panel behind - R2-3
          click: async () => { if (!world.selectionFails) world.tabSelected = true; world.visible.add(S3_PANEL_SELECTOR); },
          isVisible: async () => world.alive && world.visible.has(selector),
        }),
        waitForFunction: async (fn, arg) => { if (!(await inPage(fn, arg))) throw new Error("timeout"); },
        waitForSelector: async (selector) => { if (!world.alive || !world.visible.has(selector)) throw new Error(`selector ${selector} never appeared`); },
        screenshot: async () => Buffer.from("PNG"),
      },
    };
    currentDeployment = dep;
    // the product sees the wall clock go back across a restart and locks; a process born on a locked keystore stays broken
    if (session.clockBehindMs > 0) {
      world.rollbackLatched = true;
      // the fork PERSISTS the latch (lease/manager.ts:394-409): the lease record is rewritten, its expiry untouched
      for (const [documentId, lease] of world.leases) {
        writeRecord(world.leaseDir(), `lease/${documentId}`, Buffer.from(`lease-${documentId}-latched-${++world.leaseSeq}`));
        if (world.extendOnRollback) lease.grantedAt += 60 * 60 * 1000;
      }
    }
    world.keyringBroken = world.keyringSticky && world.keyringLocked;
    world.sessions.push(session);
    return session;
  };

  const ctx = {
    row: world.row,
    expect: caseExpect(world.row, null),
    tenant: { apiOrigin: "http://d", orgId: "01JORGANIZATION000000000", workspaceId: "01JWORKSPACE0000000000000", app: { userId: ACCOUNT_A }, foreign: { userId: ACCOUNT_B } },
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
    // the runner's own sleep: the fake advances its lease clock instead of waiting
    sleep: async (ms) => {
      world.sleptMs += ms;
      world.onlinePass();
    },
    // a `hold` rule: the request waits in the proxy until released
    waitHeld: async (id) => {
      for (let i = 0; i < 200; i += 1) {
        if (world.held.has(id)) return { id, held: 1 };
        await new Promise((resolve) => setImmediate(resolve));
      }
      return null;
    },
    release: async (id) => {
      world.held.get(id)?.();
      world.held.delete(id);
    },
    // the admin CLI on D: `{failure, evidence}` like revokeOrgOfflineLeases (the CLI's own stdout line parsed)
    revokeOfflineLeases: async () => {
      world.vmCalls.push(["revoke"]);
      if (world.revokeFails) return { failure: "uniwork-admin revoke-offline-leases exited 1: no organization", evidence: null };
      world.revoked = true;
      world.policyEpoch += 1;
      world.regrantsLeft = 1;
      const revoked = world.revokedCount ?? world.leases.size;
      const orgId = world.revokeOrgId ?? ctx.tenant.orgId;
      const epoch = world.policyEpoch;
      return { failure: null, evidence: { line: `${orgId} offline policy epoch now ${epoch}, ${revoked} live lease(s) revoked`, orgId, epoch, revoked } };
    },
  };
  world.ctx = ctx;
  world.makeSession = makeSession;
  world.copiesDir = (account = ACCOUNT_A, dep = world.deployment) => join(copiesRootDir(userData, dep), account);
  world.syncStoreDir = (store, account = ACCOUNT_A) => join(userData, "uniwork-sync", "store", world.deployment, account, store);
  world.leaseDir = (account = ACCOUNT_A) => leaseStoreDir(userData, world.deployment, account);
  return world;
}

// G7-03b (UNI-1382) W1: the offline-library driver module. The drivers themselves
// drive Electron, which only the Linux cloud runner has, so what is testable here
// is what decides a verdict WITHOUT the app: the store collector (it must never
// carry plaintext, a key or a token), the tamper (it must hit ciphertext and never
// the row that names it), the store delta, the state wait's product/VM split
// (an app that died is BLOCKED, never FAIL), the row table, and registration.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AppBlocked } from "./app-session.mjs";
import { OFFLINE_DRIVERS } from "./app-case-drivers-offline.mjs";
import {
  FL08_DEPLOYMENT_B, INDEX_RECORD_NAME, OFFLINE_STATE_TIMEOUT_MS, S3_PANEL_SELECTOR, S3_TAB_ID, S3_TAB_SELECTOR, S11_LOCK_SELECTOR,
  awaitRowState, collectOfflineState, copiesRootDir, leaseStoreDir, libraryStoreDir, listPlaintextCopies, listStoreRecords, offlineCountAssertion,
  offlineMinAssertion, offlineSnapshot, pinRecordNames, recordName, rowOf, rowStateOf, rowsOf, storeDelta, tamperLibraryBlobs, waitRowState, watchRowStates,
} from "./app-case-drivers-offline.mjs";
import { selectAppCases } from "./app-cases-lib.mjs";
import { caseExpect } from "./case-expect.mjs";
import { loadFaultCases } from "./server-cases-lib.mjs";

/** A throwaway userData with the fork's own store layout for one deployment+account. */
function scratchUserData() {
  const root = mkdtempSync(join(tmpdir(), "fl-offline-"));
  const deployment = "default";
  const account = "01JACCOUNT0000000000000000";
  const library = libraryStoreDir(root, deployment, account);
  const leases = leaseStoreDir(root, deployment, account);
  mkdirSync(library, { recursive: true });
  mkdirSync(leases, { recursive: true });
  return { root, deployment, account, library, leases, clean: () => rmSync(root, { recursive: true, force: true }) };
}

/** A record the way the fork writes it: a `.rec` named by the hash of its key. */
const writeRecord = (dir, key, bytes) => {
  const name = recordName(key);
  writeFileSync(join(dir, name), bytes);
  return name;
};

const DOC = "01JDOCAAAAAAAAAAAAAAAAAAAA";

// ---- the row table ---------------------------------------------------------------

test("the four W1 FL rows are ready, carry a driver, and every other FL row is reported not run", () => {
  const { runnable, blocked } = selectAppCases(loadFaultCases());
  const readyFl = runnable.filter((row) => row.id.startsWith("FL-")).map((row) => row.id).sort();
  assert.deepEqual(readyFl, ["FL-01", "FL-03", "FL-07", "FL-08"]);
  assert.deepEqual(Object.keys(OFFLINE_DRIVERS).sort(), readyFl);
  // the W2 rows and the two retired FL-04 letters are reported with a reason, never run
  const reasons = new Map(blocked.filter(({ row }) => row.id.startsWith("FL-")).map(({ row, reason }) => [row.id, reason]));
  assert.equal(reasons.get("FL-02"), "pending W2");
  assert.equal(reasons.get("FL-09"), "pending W2");
  assert.match(reasons.get("FL-04b"), /^SUPERSEDED: D1 /);
  assert.match(reasons.get("FL-04c"), /^BLOCKED\(G5-08d\): /);
  assert.equal(reasons.has("FL-01"), false, "a ready row is never reported as blocked");
});

test("each FL row's expect resolves the keys its driver reads, and none is a leftover", () => {
  const rows = loadFaultCases().cases.filter((row) => row.id.startsWith("FL-"));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const expect = (id) => caseExpect(byId.get(id), null);
  // FL-01: the faulted watch never sees ready, and the retry reaches it
  assert.deepEqual(expect("FL-01").offline("faultedStates"), ["interrupted"]);
  assert.deepEqual(expect("FL-01").offline("recoveredStates"), ["ready"]);
  assert.equal(expect("FL-01").offline("neverReadyWhileFaulted"), true);
  assert.equal(expect("FL-01").proxy("downloadRequestsMin") >= 2, true);
  // FL-03: a tampered blob is accepted as corrupt, never as ready
  assert.deepEqual(expect("FL-03").offline("tamperAccepts"), ["corrupt"]);
  assert.deepEqual(expect("FL-03").offline("tamperNeverStates"), ["ready"]);
  // FL-07: B sees nothing of A
  assert.equal(expect("FL-07").offline("accountBRows"), 0);
  assert.equal(expect("FL-07").offline("accountBCopies"), 0);
  // FL-08: B's scope is empty, A's rows stay
  assert.equal(expect("FL-08").offline("deploymentBRows"), 0);
  assert.equal(expect("FL-08").offline("deploymentARows"), 1);
  // reading a key a row does not carry throws: a driver can never fall back to its own number
  assert.throws(() => expect("FL-03").offline("capabilityOn"), /offline\.capabilityOn is missing/);
});

// ---- the store collector ---------------------------------------------------------

test("the collector lists record names, sizes and the sha256 of the ciphertext, and never a plaintext byte", () => {
  const scratch = scratchUserData();
  try {
    const secret = "TOP-SECRET-PLAINTEXT-DO-NOT-LEAK";
    writeRecord(scratch.library, "index", Buffer.from(secret, "utf8"));
    writeRecord(scratch.library, `pin/${DOC}`, Buffer.from("ciphertext-bytes"));
    const state = collectOfflineState({ userDataDir: scratch.root, deploymentId: scratch.deployment, accountId: scratch.account, documentIds: [DOC] });
    assert.equal(state.library.length, 2);
    const index = state.library.find((record) => record.name === INDEX_RECORD_NAME);
    assert.equal(index.sizeBytes, secret.length);
    assert.equal(index.sha256, createHash("sha256").update(secret).digest("hex"), "the sha256 is of the bytes on disk");
    assert.deepEqual(state.pinRecords, pinRecordNames([DOC]));
    // the artifact carries no key, no token and no plaintext: the serialized state never contains the secret
    assert.doesNotMatch(JSON.stringify(state), /TOP-SECRET-PLAINTEXT/);
  } finally {
    scratch.clean();
  }
});

test("the plaintext copies listing hashes the folder and file names, and never the bytes (review r1 R1-12)", () => {
  const scratch = scratchUserData();
  const secretName = "Hop-dong-mat-2026.docx";
  try {
    const accountDir = join(copiesRootDir(scratch.root, scratch.deployment), scratch.account);
    const copies = join(accountDir, "copiesha@offline");
    mkdirSync(copies, { recursive: true });
    writeFileSync(join(copies, secretName), "DOCX-PLAINTEXT-BODY");
    // a working copy beside the offline folder is the editor's, not the library's
    const working = join(accountDir, "working");
    mkdirSync(working, { recursive: true });
    writeFileSync(join(working, secretName), "WORKING-BODY");
    // another account of the same deployment is out of scope
    const other = join(copiesRootDir(scratch.root, scratch.deployment), "01JOTHER0000000000000000000", "other@offline");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, secretName), "OTHER-BODY");
    const listed = listPlaintextCopies(scratch.root, scratch.deployment, { accountIds: [scratch.account] });
    assert.equal(listed.length, 1, "only the offline copy of the account in scope is listed");
    assert.deepEqual(Object.keys(listed[0]).sort(), ["accountId", "copyKeySha256", "fileNameSha256", "sizeBytes"]);
    assert.equal(listed[0].sizeBytes, "DOCX-PLAINTEXT-BODY".length);
    assert.equal(listed[0].fileNameSha256, createHash("sha256").update(secretName, "utf8").digest("hex"));
    assert.equal(listed[0].copyKeySha256, createHash("sha256").update("copiesha@offline", "utf8").digest("hex"));
    // neither the document name nor a body byte may reach the artifact
    assert.doesNotMatch(JSON.stringify(listed), /DOCX-PLAINTEXT-BODY|Hop-dong-mat|WORKING-BODY|OTHER-BODY/);
  } finally {
    scratch.clean();
  }
});

test("listStoreRecords ignores a missing directory and every non-record file", () => {
  const scratch = scratchUserData();
  try {
    assert.deepEqual(listStoreRecords(join(scratch.root, "nope")), []);
    writeFileSync(join(scratch.library, "notes.txt"), "not a record");
    writeRecord(scratch.library, "index", Buffer.from("x"));
    assert.deepEqual(listStoreRecords(scratch.library).map((r) => r.name), [INDEX_RECORD_NAME]);
  } finally {
    scratch.clean();
  }
});

// ---- the tamper ------------------------------------------------------------------

test("the tamper flips ciphertext blobs only: the index and the pin rows survive", () => {
  const scratch = scratchUserData();
  try {
    const index = writeRecord(scratch.library, "index", Buffer.from([1, 2, 3, 4, 5]));
    const pin = writeRecord(scratch.library, `pin/${DOC}`, Buffer.from([9, 9, 9, 9, 9]));
    const blob = writeRecord(scratch.library, `blob/${DOC}/asset-1`, Buffer.from([7, 7, 7, 7, 7]));
    const tampered = tamperLibraryBlobs(scratch.library, { documentIds: [DOC] });
    assert.deepEqual(tampered.map((record) => record.name), [blob], "only the ciphertext blob is hit");
    assert.notEqual(readFileSync(join(scratch.library, blob)).toString("hex"), "0707070707");
    assert.equal(readFileSync(join(scratch.library, index)).toString("hex"), "0102030405", "the index is untouched");
    assert.equal(readFileSync(join(scratch.library, pin)).toString("hex"), "0909090909", "the pin row is untouched");
    assert.equal(tampered[0].sha256, createHash("sha256").update(readFileSync(join(scratch.library, blob))).digest("hex"), "the tampered hash is the one on disk");
  } finally {
    scratch.clean();
  }
});

// ---- the store delta -------------------------------------------------------------

test("storeDelta reports added, removed, changed and unchanged records by name", () => {
  const rec = (name, sha) => ({ name, sizeBytes: 1, sha256: sha });
  const before = { library: [rec("a", "1"), rec("b", "2")] };
  const after = { library: [rec("b", "2"), rec("c", "3"), rec("a", "9")] };
  assert.deepEqual(storeDelta(before, after), { added: ["library/c"], removed: [], changed: ["library/a"], unchanged: ["library/b"] });
  assert.deepEqual(storeDelta(null, after), { added: ["library/a", "library/b", "library/c"], removed: [], changed: [], unchanged: [] });
});

test("storeDelta keys every record by its store, so a registered sync store is visible to the delta (review r1 R1-8)", () => {
  const rec = (name, sha) => ({ name, sizeBytes: 1, sha256: sha });
  const before = { records: [{ store: "library", ...rec("a", "1") }, { store: "feed-cursors", ...rec("c", "1") }] };
  const after = { records: [{ store: "library", ...rec("a", "1") }, { store: "feed-cursors", ...rec("c", "2") }] };
  // same record NAME in two stores: the store tag is what keeps them apart
  assert.deepEqual(storeDelta(before, after), { added: [], removed: [], changed: ["feed-cursors/c"], unchanged: ["library/a"] });
});

// ---- the state wait's product/VM split -------------------------------------------

/** A shell whose snapshot answers `offlineSnapshot` (which already returns the `offline` slice); `states` is the sequence the app walks. */
const fakeSession = (states, { alive = true } = {}) => {
  let i = 0;
  return {
    alive,
    shell: {
      evaluate: async () => {
        const state = states[Math.min(i, states.length - 1)];
        i += 1;
        if (state === "__dead__") throw new Error("target closed");
        return { rows: state ? [{ documentId: DOC, state, name: "doc" }] : [] };
      },
    },
  };
};

test("offlineSnapshot answers the offline slice and null when the app cannot answer", async () => {
  const ok = await offlineSnapshot(fakeSession(["downloading"]));
  assert.equal(rowStateOf(ok, DOC), "downloading");
  assert.equal(rowOf(ok, DOC)?.name, "doc");
  assert.deepEqual(rowsOf(null), []);
  assert.equal(await offlineSnapshot({ shell: { evaluate: async () => { throw new Error("gone"); } } }), null);
});

test("watchRowStates samples the states in order and stops on the wanted one", async () => {
  const watch = await watchRowStates(fakeSession(["downloading", "interrupted"]), DOC, { until: ["interrupted"], timeout: 2_000, interval: 1 });
  assert.deepEqual(watch.states, ["downloading", "interrupted"]);
  assert.equal(watch.found, "interrupted");
});

test("a wait that never satisfies while the app is alive is null: the driver FAILs on it", async () => {
  const session = fakeSession(["downloading"]);
  assert.equal(await waitRowState(session, DOC, ["ready"], { timeout: 5, interval: 1 }), null);
  assert.equal(await awaitRowState({ appAlive: async () => true }, session, DOC, ["ready"], { timeout: 5 }), null);
});

test("a snapshot that cannot answer while the app is alive is a product FAIL, not BLOCKED", async () => {
  // the liveness probe is ctx.appAlive, not the snapshot: a probe that fails for a
  // signed-out app must not turn a product claim into a harness claim
  const blind = { shell: { evaluate: async () => { throw new Error("no uniworkSyncCenter.getSnapshot"); } } };
  const ctx = { appAlive: async () => true };
  assert.equal(await awaitRowState(ctx, blind, DOC, ["ready"], { timeout: 5 }), null);
});

test("a wait whose app died is BLOCKED, never FAIL: the harness is the precondition", async () => {
  const session = fakeSession(["downloading"], { alive: false });
  await assert.rejects(() => awaitRowState({ appAlive: async (s) => s.alive }, session, DOC, ["ready"], { timeout: 5 }), (error) => error instanceof AppBlocked && /harness down/.test(error.message));
  assert.equal(OFFLINE_STATE_TIMEOUT_MS > 5, true, "the shipped timeout is the real one; the tests shorten it");
});

test("appAlive is false for a dead app, so the split picks BLOCKED", async () => {
  const dead = fakeSession(["__dead__"], { alive: false });
  await assert.rejects(() => awaitRowState({ appAlive: async (s) => s.alive }, dead, DOC, ["ready"], { timeout: 5 }), AppBlocked);
});

// ---- the offline assertions ------------------------------------------------------

test("the offline assertions read their numbers from expect, never a literal", () => {
  const row = loadFaultCases().cases.find((r) => r.id === "FL-08");
  const ctx = { expect: caseExpect(row, null) };
  assert.deepEqual([offlineCountAssertion(ctx, "b_rows", "deploymentBRows", 0).ok, offlineCountAssertion(ctx, "b_rows", "deploymentBRows", 0).expected], [true, 0]);
  assert.equal(offlineCountAssertion(ctx, "b_rows", "deploymentBRows", 2).ok, false);
  assert.equal(offlineMinAssertion(ctx, "x", "deploymentARows", 1).expected, ">= 1");
  assert.equal(offlineMinAssertion(ctx, "x", "deploymentARows", 0).ok, false);
  assert.throws(() => offlineCountAssertion(ctx, "x", "accountBRows", 0), /offline\.accountBRows is missing/);
});

// ---- the S3 / S11 selectors and the deployment switch ----------------------------

test("the S3 tab and the S11 lock panel are addressed by constants, and FL-08's B deployment is a valid store segment", () => {
  assert.equal(S3_TAB_ID, "offline");
  assert.match(S3_TAB_SELECTOR, /role="tab".*tab-offline/);
  // the ACTIVE panel of the offline tab, not any tabpanel (review r1 R1-10)
  assert.equal(S3_PANEL_SELECTOR, '[role="tabpanel"][id$="-panel-offline"]');
  // the fork's own lock markup (UniworkLockPanel.tsx `.uw-lock-layer > .uw-lock-panel`),
  // never a class-prefix match that also hits `sc-lock` / `wb-block` (review r1 R1-11)
  assert.equal(S11_LOCK_SELECTOR, ".uw-lock-layer .uw-lock-panel");
  assert.ok(S11_LOCK_SELECTOR.includes("lock"));
  // fork keys.ts SEGMENT: the store refuses a scope the fork would reject
  assert.match(FL08_DEPLOYMENT_B, /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/);
});

test("the driver module registers the W1 rows and reads no store file of its own", () => {
  const source = readFileSync(new URL("./app-case-drivers-offline.mjs", import.meta.url), "utf8");
  // the driver writes no store file: it reads the fork's stores and writes only its own evidence
  assert.doesNotMatch(source, /writeFileSync\([^)]*libraryStoreDir/, "a driver never writes a library store");
  assert.doesNotMatch(source, /writeFileSync\([^)]*leaseStoreDir/, "a driver never writes a lease store");
  // the only writeFileSync calls are the tamper, the store-evidence files
  // (before / faulted / after) and a screenshot
  const writes = [...source.matchAll(/writeFileSync\(/g)].length;
  assert.equal(writes, 5, "tamper, three store-evidence files and a screenshot: no other write");
});

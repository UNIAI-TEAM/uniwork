// G8-A09 library half (UNI-1414 T4): after sign-in the library shows the
// workspaces with the role, the shared-with-me documents and the properties;
// create / rename / archive from the app act on the one UniWork document with
// no second copy; a web rename reaches the desktop title after a focus.
// decideG8A09Docs is the pure decision; runLibrary is the flow.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { a09Scenario } from "./a09-scenario.helper.mjs";
import { createFakeWorld } from "./fake-world.mjs";
import { countWorkingCopies, decideG8A09Docs, runLibrary } from "./library.mjs";
import { rowArtifactPath, runRowModule } from "./run-row.mjs";

const goodDocs = (over = {}) => ({
  workspaces: { ok: true, ids: ["ws-W1"], expectedWorkspaceId: "ws-W1", myRole: "member", expectedRoles: ["member"] },
  shared: { ok: true, ids: ["doc-1"], expectedDocumentId: "doc-1" },
  properties: {
    app: { documentId: "doc-1", workspaceId: "ws-W2", title: "T", myLevel: "view", version: 1, createdById: "user-A", updatedById: "user-A" },
    server: { id: "doc-1", workspace_id: "ws-W2", title: "T", my_level: "view", current_version: 1, created_by: "user-A", updated_by: "user-A" },
  },
  create: { ok: true, before: 3, after: 4, createdId: "doc-new", expectedTitle: "N", titleCount: 1, serverStatus: 200, serverTitle: "N", openOk: true, workingCopies: 1 },
  rename: { ok: true, expectedTitle: "N2", serverStatus: 200, serverTitle: "N2" },
  webRename: { patchStatus: 200, expectedTitle: "N3", appTitleAfterFocus: "N3", focuses: 2 },
  archive: { archiveOk: true, serverArchived: true, restoreOk: true, serverRestored: true },
  ...over,
});
const withCreate = (patch) => goodDocs({ create: { ...goodDocs().create, ...patch } });

test("decideG8A09Docs: the whole library claim true -> PASS with every check ok", () => {
  const d = decideG8A09Docs(goodDocs());
  assert.equal(d.status, "PASS", d.reason);
  assert.deepEqual(Object.keys(d.checks).sort(), [
    "archiveReflected", "createdOnce", "createdPlusOne", "openedById", "propertiesEqualServer", "renameReflected",
    "restoreReflected", "sharedListed", "webRenameOnDesktop", "workingCopyUnique", "workspacesWithRole",
  ]);
});

test("decideG8A09Docs: create must be +1 document, opened by its id, with no second working copy", () => {
  assert.match(decideG8A09Docs(withCreate({ after: 3 })).reason, /createdPlusOne/);
  assert.match(decideG8A09Docs(withCreate({ after: 5 })).reason, /createdPlusOne/);
  assert.match(decideG8A09Docs(withCreate({ titleCount: 2 })).reason, /createdOnce/);
  assert.match(decideG8A09Docs(withCreate({ serverStatus: 404 })).reason, /createdOnce/);
  assert.match(decideG8A09Docs(withCreate({ serverTitle: "other" })).reason, /createdOnce/);
  assert.match(decideG8A09Docs(withCreate({ openOk: false })).reason, /openedById/);
  assert.match(decideG8A09Docs(withCreate({ workingCopies: 2 })).reason, /workingCopyUnique/);
  assert.match(decideG8A09Docs(withCreate({ workingCopies: 0 })).reason, /workingCopyUnique/);
  assert.match(decideG8A09Docs(withCreate({ ok: false, error: "quota_exceeded" })).reason, /quota_exceeded/);
});

test("decideG8A09Docs: rename and archive are reflected on GET /documents/{id}", () => {
  assert.match(decideG8A09Docs(goodDocs({ rename: { ok: true, expectedTitle: "N2", serverStatus: 200, serverTitle: "N" } })).reason, /renameReflected/);
  assert.match(decideG8A09Docs(goodDocs({ rename: { ok: false, error: "forbidden", expectedTitle: "N2" } })).reason, /renameReflected/);
  assert.match(decideG8A09Docs(goodDocs({ archive: { ...goodDocs().archive, serverArchived: false } })).reason, /archiveReflected/);
  assert.match(decideG8A09Docs(goodDocs({ archive: { ...goodDocs().archive, serverRestored: false } })).reason, /restoreReflected/);
});

test("decideG8A09Docs: a web rename must reach the desktop title after a focus", () => {
  assert.match(decideG8A09Docs(goodDocs({ webRename: { patchStatus: 200, expectedTitle: "N3", appTitleAfterFocus: "N2", focuses: 7 } })).reason, /webRenameOnDesktop/);
  assert.match(decideG8A09Docs(goodDocs({ webRename: { patchStatus: 409, expectedTitle: "N3", appTitleAfterFocus: "N3", focuses: 0 } })).reason, /webRenameOnDesktop/);
});

test("decideG8A09Docs: the shared-with-me list must contain the shared document, the workspaces the role", () => {
  assert.match(decideG8A09Docs(goodDocs({ shared: { ok: true, ids: [], expectedDocumentId: "doc-1" } })).reason, /sharedListed/);
  assert.match(decideG8A09Docs(goodDocs({ shared: { ok: false, error: "network", expectedDocumentId: "doc-1" } })).reason, /sharedListed/);
  assert.match(decideG8A09Docs(goodDocs({ workspaces: { ...goodDocs().workspaces, ids: [] } })).reason, /workspacesWithRole/);
  assert.match(decideG8A09Docs(goodDocs({ workspaces: { ...goodDocs().workspaces, myRole: null } })).reason, /workspacesWithRole/);
  assert.match(decideG8A09Docs(goodDocs({ workspaces: { ...goodDocs().workspaces, myRole: "owner" } })).reason, /workspacesWithRole/);
});

test("decideG8A09Docs: properties equal the server (title, workspace, level, version, author ids); an absent server level reads as view", () => {
  const server = goodDocs().properties.server;
  const app = goodDocs().properties.app;
  assert.match(decideG8A09Docs(goodDocs({ properties: { app: { ...app, version: 2 }, server } })).reason, /propertiesEqualServer/);
  assert.match(decideG8A09Docs(goodDocs({ properties: { app: { ...app, title: "x" }, server } })).reason, /propertiesEqualServer/);
  assert.match(decideG8A09Docs(goodDocs({ properties: { app: { ...app, myLevel: "manage" }, server } })).reason, /propertiesEqualServer/);
  assert.match(decideG8A09Docs(goodDocs({ properties: { app: { ...app, workspaceId: "ws-W9" }, server } })).reason, /propertiesEqualServer/);
  const { my_level: _l, ...noLevel } = server;
  void _l;
  assert.equal(decideG8A09Docs(goodDocs({ properties: { app, server: noLevel } })).status, "PASS");
  assert.equal(decideG8A09Docs(goodDocs({ properties: { app: { ...app, myLevel: null }, server: noLevel } })).status, "PASS");
  assert.match(decideG8A09Docs(goodDocs({ properties: { app: null, server } })).reason, /propertiesEqualServer/);
});

test("decideG8A09Docs: an empty record is FAIL, never PASS or BLOCKED", () => {
  assert.equal(decideG8A09Docs({}).status, "FAIL");
  assert.equal(decideG8A09Docs(undefined).status, "FAIL");
});

// ---- the working copies on disk ----------------------------------------------

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "g819-lib-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const copy = (account, key, binding) => {
  const d = join(dir, "uniwork-documents", "harness", account, key);
  mkdirSync(d, { recursive: true });
  if (binding) writeFileSync(join(d, "binding.json"), JSON.stringify(binding));
};

test("countWorkingCopies: counts the directories of one document across accounts, by key or by binding", () => {
  assert.equal(countWorkingCopies(dir, "doc-a"), 0);
  copy("acc-1", "doc-a", { documentId: "doc-a" });
  assert.equal(countWorkingCopies(dir, "doc-a"), 1);
  copy("acc-1", "doc-b", { documentId: "doc-b" });
  assert.equal(countWorkingCopies(dir, "doc-a"), 1, "another document is not a copy");
  copy("acc-1", "copy-key", { documentId: "doc-a" });
  assert.equal(countWorkingCopies(dir, "doc-a"), 2, "a second directory bound to the same document");
  copy("acc-2", "doc-a", null);
  assert.equal(countWorkingCopies(dir, "doc-a"), 3, "a directory named by the id counts even without a binding");
  assert.equal(countWorkingCopies(join(dir, "nowhere"), "doc-a"), 0);
});

// ---- the flow ------------------------------------------------------------------

let runDir;
let userData;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-a09l-"));
  userData = join(runDir, "user-data");
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(runDir, "ports.env"), `API_ORIGIN=http://127.0.0.1:9\nWEB_ORIGIN=http://127.0.0.1:8\nOFFICE_FORK_SHA=7d665a54\nUNIWORK_USER_DATA=${userData}\n`);
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "up" }));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

async function run({ viewerKey = "M", faults = {} } = {}) {
  const fake = createFakeWorld();
  const sc = a09Scenario(fake, { stamp: "t1", viewerKey, userDataDir: userData, faults });
  const exit = await runRowModule(
    { row: "G8-A09", fixture: "fx-docx-report-vi", runDir, module: "library", timeoutMs: 5_000, worldFactory: () => fake.world },
    async (ctx) => {
      const world = await ctx.getWorld();
      const ctrl = await fake.app.connectApp({});
      return runLibrary(ctx, { ctrl, world, viewerKey, stamp: "t1", pollMs: 0, waitMs: 5 });
    },
  );
  const artifact = JSON.parse(readFileSync(rowArtifactPath(runDir, "G8-A09", "fx-docx-report-vi"), "utf8"));
  return { exit, artifact, fake, sc };
}

test("runLibrary as M in org X: workspaces, a W2 document shared by A, properties, create, rename, web rename, archive -> PASS", async () => {
  const { exit, artifact, fake, sc } = await run();
  assert.equal(artifact.status, "PASS", artifact.reason);
  assert.equal(exit, 0);
  for (const step of ["workspaces", "sharedWithMe", "properties", "create", "rename", "webRename", "archive", "decide:docs"]) {
    assert.equal(artifact.steps[step]?.status, "PASS", `${step}: ${artifact.steps[step]?.reason}`);
  }
  const up = fake.calls.world.find((c) => c.key === "upload");
  assert.deepEqual(up.args.slice(0, 3), ["A", "W2", "fx-docx-report-vi"], "A uploads the shared document to W2, which M is not in");
  const share = fake.calls.world.find((c) => c.key === "share");
  assert.deepEqual([share.args[0], share.args[2], share.args[3]], ["A", sc.viewer.id, "view"]);
  assert.equal(sc.state.docs.get("doc-new").title, sc.names.web, "the web rename is what the server ends with");
  assert.equal(sc.state.docs.get("doc-new").archived_at, null, "archived then restored");
});

test("runLibrary as A (no second org): B shares a W2 document with A and the same claims hold", async () => {
  const { exit, artifact, fake } = await run({ viewerKey: "A" });
  assert.equal(artifact.status, "PASS", artifact.reason);
  assert.equal(exit, 0);
  assert.deepEqual(fake.calls.world.find((c) => c.key === "upload").args.slice(0, 2), ["B", "W2"]);
});

test("runLibrary: the web rename uses PATCH /documents/{id} with the revision read first, and the desktop is focused until the title changes", async () => {
  const { fake } = await run();
  const patch = fake.calls.api.find((c) => c.key === "patchDocument");
  assert.equal(patch.args.body.revision, "1");
  assert.equal(patch.args.body.title, "G8-A09 t1 web");
  assert.ok(fake.calls.app.filter((c) => c.key === "focus").length >= 2, "focus is repeated while the title is old");
});

test("runLibrary: create that adds no document -> FAIL naming createdPlusOne", async () => {
  const { exit, artifact } = await run({ faults: { createAddsNothing: true } });
  assert.equal(exit, 1);
  assert.match(artifact.reason, /createdPlusOne/);
});

test("runLibrary: create that leaves a copy, or a second working copy on disk -> FAIL", async () => {
  const copyMade = await run({ faults: { createMakesCopy: true } });
  assert.equal(copyMade.exit, 1);
  assert.match(copyMade.artifact.reason, /createdPlusOne|createdOnce/);
  const second = await run({ faults: { extraWorkingCopy: true } });
  assert.equal(second.exit, 1);
  assert.match(second.artifact.reason, /workingCopyUnique/);
});

test("runLibrary: a rename the server never sees, an archive that is not archived, a restore that sticks -> FAIL", async () => {
  assert.match((await run({ faults: { renameNotReflected: true } })).artifact.reason, /renameReflected/);
  assert.match((await run({ faults: { archiveNotReflected: true } })).artifact.reason, /archiveReflected/);
  assert.match((await run({ faults: { restoreNotReflected: true } })).artifact.reason, /restoreReflected/);
});

test("runLibrary: the desktop never gets the web title -> FAIL after the bounded focus loop, not a hang", async () => {
  const { exit, artifact, fake } = await run({ faults: { webRenameNeverArrives: true } });
  assert.equal(exit, 1);
  assert.match(artifact.reason, /webRenameOnDesktop/);
  assert.ok(fake.calls.app.filter((c) => c.key === "focus").length <= 12, "the loop is bounded");
});

test("runLibrary: a missing shared document or properties that differ from the server -> FAIL", async () => {
  assert.match((await run({ faults: { sharedMissing: true } })).artifact.reason, /sharedListed/);
  assert.match((await run({ faults: { propertiesVersionOff: true } })).artifact.reason, /propertiesEqualServer/);
});

test("runLibrary: an app call that times out is a FAIL of that step, and the later steps still report", async () => {
  const fake = createFakeWorld();
  a09Scenario(fake, { stamp: "t1", userDataDir: userData });
  const { FAKE_TIMEOUT } = await import("./fake-world.mjs");
  fake.script.queue("app.aiOffice.uniworkListWorkspaces", FAKE_TIMEOUT);
  const exit = await runRowModule(
    { row: "G8-A09", fixture: "fx-docx-report-vi", runDir, module: "library", timeoutMs: 5_000, worldFactory: () => fake.world },
    async (ctx) => runLibrary(ctx, { ctrl: await fake.app.connectApp({}), world: await ctx.getWorld(), viewerKey: "M", stamp: "t1", pollMs: 0, waitMs: 5 }),
  );
  const artifact = JSON.parse(readFileSync(rowArtifactPath(runDir, "G8-A09", "fx-docx-report-vi"), "utf8"));
  assert.equal(exit, 1);
  assert.equal(artifact.steps.workspaces.status, "FAIL");
  assert.equal(artifact.steps.create.status, "PASS", "independent steps keep running");
});

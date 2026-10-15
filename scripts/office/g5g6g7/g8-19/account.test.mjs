// G8-A09 account half (UNI-1414 T4): org choice with several organizations
// (remembered), and a deactivated member losing access. decideG8A09Org is the
// pure decision; runAccount is the flow, driven here through the g8-19 fake world.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { SQL_MEMBERSHIP_BLOCKER } from "../harness/world.mjs";
import { a09Scenario } from "./a09-scenario.helper.mjs";
import { decideG8A09, decideG8A09Org, runAccount } from "./account.mjs";
import { createFakeWorld } from "./fake-world.mjs";
import { rowArtifactPath, runRowModule } from "./run-row.mjs";

const goodOrg = (over = {}) => ({
  multiOrg: { status: "SEEDED", via: "sql" },
  signIn: { orgChoiceShown: true, orgApiCallsBeforeChoice: 0, orgIds: ["org-X", "org-Y"], expectedOrgIds: ["org-X", "org-Y"] },
  choose: { orgId: "org-Y", expectedOrgId: "org-Y", needsOrgChoice: false },
  resignIn: { orgChoiceShown: false, orgId: "org-Y", expectedOrgId: "org-Y" },
  deactivated: { deactivateStatus: 200, listWorkspacesError: "member_deactivated", createError: "member_deactivated" },
  ...over,
});

test("decideG8A09Org: the choice is shown with zero org API calls before it, the pick sticks, a deactivated member is refused -> PASS", () => {
  const d = decideG8A09Org(goodOrg());
  assert.equal(d.status, "PASS", d.reason);
  assert.deepEqual(Object.keys(d.checks).sort(), ["choiceListsBothOrgs", "choiceShown", "deactivatedCreateRefused", "deactivatedLibraryRefused", "noOrgCallBeforeChoice", "pickApplied", "rememberedNoStep", "rememberedOrgUsed"]);
  assert.ok(Object.values(d.checks).every((c) => c.ok), JSON.stringify(d.checks));
});

test("decideG8A09Org: no org choice for an account with two organizations -> FAIL", () => {
  const d = decideG8A09Org(goodOrg({ signIn: { orgChoiceShown: false, orgApiCallsBeforeChoice: null, orgIds: ["org-X", "org-Y"], expectedOrgIds: ["org-X", "org-Y"] } }));
  assert.equal(d.status, "FAIL");
  assert.match(d.reason, /choiceShown/);
});

test("decideG8A09Org: any org API call before the choice, or one that cannot be measured, is FAIL", () => {
  const many = decideG8A09Org(goodOrg({ signIn: { ...goodOrg().signIn, orgApiCallsBeforeChoice: 3 } }));
  assert.equal(many.status, "FAIL");
  assert.match(many.reason, /noOrgCallBeforeChoice/);
  assert.match(many.checks.noOrgCallBeforeChoice.detail, /3/);
  const unknown = decideG8A09Org(goodOrg({ signIn: { ...goodOrg().signIn, orgApiCallsBeforeChoice: null } }));
  assert.equal(unknown.status, "FAIL");
  assert.match(unknown.checks.noOrgCallBeforeChoice.detail, /not measurable/);
});

test("decideG8A09Org: the picker must list both organizations", () => {
  const d = decideG8A09Org(goodOrg({ signIn: { ...goodOrg().signIn, orgIds: ["org-X"] } }));
  assert.equal(d.status, "FAIL");
  assert.match(d.reason, /choiceListsBothOrgs/);
});

test("decideG8A09Org: re-sign-in must show no step and use the remembered org", () => {
  const again = decideG8A09Org(goodOrg({ resignIn: { orgChoiceShown: true, orgId: null, expectedOrgId: "org-Y" } }));
  assert.equal(again.status, "FAIL");
  assert.match(again.reason, /rememberedNoStep/);
  const other = decideG8A09Org(goodOrg({ resignIn: { orgChoiceShown: false, orgId: "org-X", expectedOrgId: "org-Y" } }));
  assert.equal(other.status, "FAIL");
  assert.match(other.reason, /rememberedOrgUsed/);
  const notApplied = decideG8A09Org(goodOrg({ choose: { orgId: "org-X", expectedOrgId: "org-Y", needsOrgChoice: false } }));
  assert.match(notApplied.reason, /pickApplied/);
});

test("decideG8A09Org: deactivate -> the library and create calls answer member_deactivated, nothing else counts", () => {
  for (const bad of [null, undefined, "forbidden", "network", "ok"]) {
    const d = decideG8A09Org(goodOrg({ deactivated: { deactivateStatus: 200, listWorkspacesError: bad, createError: "member_deactivated" } }));
    assert.equal(d.status, "FAIL", String(bad));
    assert.match(d.reason, /deactivatedLibraryRefused/);
  }
  const create = decideG8A09Org(goodOrg({ deactivated: { deactivateStatus: 200, listWorkspacesError: "member_deactivated", createError: null } }));
  assert.match(create.reason, /deactivatedCreateRefused/);
  const server = decideG8A09Org(goodOrg({ deactivated: { deactivateStatus: 500, listWorkspacesError: "member_deactivated", createError: "member_deactivated" } }));
  assert.equal(server.status, "FAIL");
  assert.match(server.reason, /deactivate/i);
});

test("decideG8A09Org: M without the second org is BLOCKED by the named SQL blocker, never PASS; no blocker text is FAIL", () => {
  const d = decideG8A09Org({ multiOrg: { status: "BLOCKED", blocker: SQL_MEMBERSHIP_BLOCKER } });
  assert.equal(d.status, "BLOCKED");
  assert.equal(d.blocker, SQL_MEMBERSHIP_BLOCKER);
  assert.equal(decideG8A09Org({ multiOrg: { status: "BLOCKED" } }).status, "FAIL");
  assert.equal(decideG8A09Org({}).status, "FAIL");
});

test("decideG8A09: FAIL beats BLOCKED beats PASS", () => {
  const pass = { status: "PASS", reason: "" };
  const blocked = { status: "BLOCKED", reason: "x", blocker: "b", owner: "g7-qa" };
  const fail = { status: "FAIL", reason: "docs broke" };
  assert.equal(decideG8A09(pass, pass).status, "PASS");
  const b = decideG8A09(blocked, pass);
  assert.deepEqual([b.status, b.blocker, b.owner], ["BLOCKED", "b", "g7-qa"]);
  const f = decideG8A09(blocked, fail);
  assert.equal(f.status, "FAIL");
  assert.match(f.reason, /docs broke/);
  assert.equal(decideG8A09(fail, pass).status, "FAIL");
});

// ---- the flow, through runRowModule and the fake world ------------------------

let runDir;
let userData;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-a09-"));
  userData = join(runDir, "user-data");
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(runDir, "ports.env"), `API_ORIGIN=http://127.0.0.1:9\nWEB_ORIGIN=http://127.0.0.1:8\nOFFICE_FORK_SHA=7d665a54\nUNIWORK_USER_DATA=${userData}\n`);
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "up" }));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

async function run({ sqlMembership = true, faults = {}, connectApp = null } = {}) {
  const fake = createFakeWorld({ sqlMembership });
  const sc = a09Scenario(fake, { stamp: "t1", viewerKey: sqlMembership ? "M" : "A", userDataDir: userData, faults });
  const exit = await runRowModule(
    { row: "G8-A09", fixture: "fx-docx-report-vi", runDir, module: "account", timeoutMs: 5_000, worldFactory: () => fake.world },
    (ctx) => runAccount(ctx, { connectApp: connectApp ?? fake.app.connectApp, stamp: "t1", pollMs: 0, waitMs: 5 }),
  );
  const artifact = JSON.parse(readFileSync(rowArtifactPath(runDir, "G8-A09", "fx-docx-report-vi"), "utf8"));
  return { exit, artifact, fake, sc };
}

test("runAccount: org choice, remembered org, library and a deactivated member -> PASS (0), deactivation last", async () => {
  const { exit, artifact, fake } = await run();
  assert.equal(artifact.status, "PASS", artifact.reason);
  assert.equal(exit, 0);
  for (const step of ["signIn:orgChoice", "selectOrg:Y", "reSignIn:remembered", "selectOrg:X", "decide:org", "decide:docs", "deactivate"]) {
    assert.equal(artifact.steps[step]?.status, "PASS", `${step}: ${artifact.steps[step]?.reason}`);
  }
  const order = fake.calls.all.map((c) => c.key);
  assert.ok(order.indexOf("deactivate") > order.lastIndexOf("aiOffice.uniworkRestoreDocument"), order.join(","));
  assert.ok(order.indexOf("signIn") < order.indexOf("selectOrg"));
  assert.deepEqual(artifact.details.multiOrg.status, "SEEDED");
  assert.doesNotMatch(JSON.stringify(artifact), /fake-password|fake-token|@example\.com/);
});

test("runAccount: the picker asked twice (forgets the pick) -> FAIL (1) naming rememberedNoStep", async () => {
  const { exit, artifact } = await run({ faults: { forgetsOrg: true } });
  assert.equal(exit, 1);
  assert.match(artifact.reason, /rememberedNoStep/);
});

test("runAccount: an org API call before the choice -> FAIL naming noOrgCallBeforeChoice", async () => {
  const { exit, artifact } = await run({ faults: { orgCallsBeforeChoice: 2 } });
  assert.equal(exit, 1);
  assert.match(artifact.reason, /noOrgCallBeforeChoice/);
});

test("runAccount: a deactivated member who still lists workspaces -> FAIL", async () => {
  const { exit, artifact } = await run({ faults: { deactivatedStillWorks: true } });
  assert.equal(exit, 1);
  assert.match(artifact.reason, /deactivatedLibraryRefused/);
});

test("runAccount: no raw-SQL second org (G819_ALLOW_SQL_MEMBERSHIP unset) -> BLOCKED 77 with the named blocker; the library half still ran as A", async () => {
  const { exit, artifact, fake } = await run({ sqlMembership: false });
  assert.equal(exit, 77);
  assert.equal(artifact.status, "BLOCKED");
  assert.equal(artifact.blocker, SQL_MEMBERSHIP_BLOCKER);
  assert.equal(artifact.steps["decide:docs"].status, "PASS");
  assert.ok(fake.calls.app.some((c) => c.key === "aiOffice.uniworkArchiveDocument"));
  assert.equal(fake.calls.world.some((c) => c.key === "deactivate"), false, "nobody is deactivated without M");
});

test("runAccount: the app cannot be driven -> the reason of appUnavailable, FAIL stays FAIL and BLOCKED keeps its reason", async () => {
  const unavailable = (status, reason) => async () => {
    const err = new Error(reason);
    err.appUnavailable = { status, reason };
    throw err;
  };
  const fail = await run({ connectApp: unavailable("FAIL", "CDP refused") });
  assert.equal(fail.exit, 1);
  assert.match(fail.artifact.reason, /CDP refused/);
  const blocked = await run({ connectApp: unavailable("BLOCKED", "no CDP port in ports.env") });
  assert.equal(blocked.exit, 77);
  assert.equal(blocked.artifact.blocker, "no CDP port in ports.env");
});

test("runAccount writes the artifact under reports/g7-qa/g8-a09/<fixture>.json", async () => {
  await run();
  assert.ok(existsSync(join(runDir, "reports", "g7-qa", "g8-a09", "fx-docx-report-vi.json")));
});

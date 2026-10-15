// G8-A09 row module (UNI-1414 T4): after sign-in an account with several
// organizations is asked to choose one (and the choice is remembered), the
// library shows what it should (library.mjs), and a deactivated member loses
// access. `decideG8A09Org(record)` is the pure decision for the account half;
// `decideG8A09` joins it with library.mjs's `decideG8A09Docs`; `runAccount` is
// the flow, run as the CLI `node g8-19/account.mjs --row G8-A09 --fixture <id> --run-dir <dir>`.
//
// Order matters: user M belongs to org Y (made through the API) and org X (a raw
// SQL membership, ADR 0032 refuses a second active org through every API; it is
// a test seed, allowed only with G819_ALLOW_SQL_MEMBERSHIP=1). The flow is
//   1. sign in M: the picker must show with no org-scoped request before the pick;
//   2. pick Y; 3. sign out and in again: no picker, Y is back (remembered);
//   4. switch to X and run the library claims there (M reads W1, and a W2
//      document shared by A shows in shared-with-me);
//   5. LAST: A deactivates M in X; the library and create calls must answer
//      member_deactivated. M is used by no other row, but the deactivation is
//      permanent for the run, so nothing may run after it.
// Without the SQL seed the org steps are BLOCKED with the named blocker and the
// library half runs as A (one org, no picker).
import { isMainModule } from "../harness/lib.mjs";
import { decideG8A09Docs, decisionStep, gatherLibrary } from "./library.mjs";
import { rowMain } from "./run-row.mjs";

const DEACTIVATED = "member_deactivated";
const BLOCK_OWNER = "g7-qa";

function check(ok, detail) {
  return { ok: Boolean(ok), detail: String(detail) };
}

const is2xx = (status) => Number.isInteger(status) && status >= 200 && status < 300;

/**
 * The verdict for the account half. `record`:
 *   multiOrg    { status: "SEEDED" | "BLOCKED", blocker? }   from the world (M)
 *   signIn      { orgChoiceShown, orgApiCallsBeforeChoice, orgIds, expectedOrgIds }
 *   choose      { orgId, expectedOrgId, needsOrgChoice }    the status after accountSelectOrg
 *   resignIn    { orgChoiceShown, orgId, expectedOrgId }    the status after sign-out + sign-in
 *   deactivated { deactivateStatus, listWorkspacesError, createError }
 * Returns { status: "PASS" | "FAIL" | "BLOCKED", reason, blocker?, owner?, checks }.
 * BLOCKED only while the second org could not be seeded, and only with the
 * world's named blocker; anything else that is not true is FAIL.
 */
export function decideG8A09Org(record) {
  const r = record ?? {};
  const multi = r.multiOrg;
  if (multi?.status === "BLOCKED") {
    const blocker = String(multi.blocker ?? "").trim();
    return blocker
      ? { status: "BLOCKED", reason: `second organization not seeded: ${blocker}`, blocker, owner: BLOCK_OWNER, checks: {} }
      : { status: "FAIL", reason: "BLOCKED without a named blocker (world.users.M.multiOrg has none)", checks: {} };
  }
  if (multi?.status !== "SEEDED") return { status: "FAIL", reason: "the world did not report whether M has two organizations", checks: {} };

  const signIn = r.signIn ?? {};
  const choose = r.choose ?? {};
  const resign = r.resignIn ?? {};
  const off = r.deactivated ?? {};
  const checks = {};

  checks.choiceShown = check(signIn.orgChoiceShown === true, `org choice ${signIn.orgChoiceShown === true ? "shown" : "not shown"} for an account with two organizations`);
  const missing = (signIn.expectedOrgIds ?? []).filter((id) => !(signIn.orgIds ?? []).includes(id));
  checks.choiceListsBothOrgs = check((signIn.expectedOrgIds ?? []).length > 0 && missing.length === 0, missing.length === 0 ? `the picker lists ${(signIn.orgIds ?? []).length} organization(s)` : `the picker misses ${missing.join(", ")}`);
  const calls = signIn.orgApiCallsBeforeChoice;
  checks.noOrgCallBeforeChoice = check(calls === 0, calls === 0 ? "0 org-scoped requests before the choice" : calls == null ? "org-scoped requests before the choice are not measurable (no server log)" : `${calls} org-scoped request(s) before the choice`);
  checks.pickApplied = check(choose.orgId != null && choose.orgId === choose.expectedOrgId && choose.needsOrgChoice === false, `after the pick the app works in ${choose.orgId ?? "no organization"} (expected ${choose.expectedOrgId})`);
  checks.rememberedNoStep = check(resign.orgChoiceShown === false, `re-sign-in ${resign.orgChoiceShown === false ? "asks nothing" : "shows the picker again"}`);
  checks.rememberedOrgUsed = check(resign.orgId != null && resign.orgId === resign.expectedOrgId, `re-sign-in works in ${resign.orgId ?? "no organization"} (expected ${resign.expectedOrgId})`);

  const deactivated = is2xx(off.deactivateStatus);
  const why = `deactivate answered ${off.deactivateStatus ?? "nothing"}`;
  checks.deactivatedLibraryRefused = deactivated ? check(off.listWorkspacesError === DEACTIVATED, `workspace list for a deactivated member answered ${off.listWorkspacesError ?? "ok"} (expected ${DEACTIVATED})`) : check(false, why);
  checks.deactivatedCreateRefused = deactivated ? check(off.createError === DEACTIVATED, `create for a deactivated member answered ${off.createError ?? "ok"} (expected ${DEACTIVATED})`) : check(false, why);

  const failed = Object.entries(checks).filter(([, c]) => !c.ok);
  return failed.length === 0
    ? { status: "PASS", reason: "", checks }
    : { status: "FAIL", reason: failed.map(([name, c]) => `${name}: ${c.detail}`).join("; "), checks };
}

/** the row verdict from the two halves: FAIL beats BLOCKED beats PASS */
export function decideG8A09(org, docs) {
  const parts = [
    ["org", org],
    ["docs", docs],
  ];
  const failed = parts.filter(([, d]) => d?.status !== "PASS" && d?.status !== "BLOCKED");
  if (failed.length > 0) return { status: "FAIL", reason: failed.map(([name, d]) => `${name}: ${d?.reason || d?.status || "no verdict"}`).join(" | ") };
  const blocked = parts.filter(([, d]) => d.status === "BLOCKED");
  if (blocked.length > 0) {
    return {
      status: "BLOCKED",
      reason: blocked.map(([, d]) => d.reason).join(" | "),
      blocker: blocked.map(([, d]) => d.blocker).filter(Boolean).join("; "),
      owner: [...new Set(blocked.map(([, d]) => d.owner).filter(Boolean))].join(", "),
    };
  }
  return { status: "PASS", reason: "" };
}

const unavailable = (err) => {
  const info = err?.appUnavailable;
  if (!info) return null;
  return info.status === "BLOCKED" && String(info.reason ?? "").trim()
    ? { status: "BLOCKED", reason: info.reason, blocker: info.reason, owner: BLOCK_OWNER }
    : { status: "FAIL", reason: info.reason || err.message };
};

/**
 * The G8-A09 flow (see the header for the order). deps: { connectApp?, stamp?,
 * pollMs?, waitMs?, sleep?, userDataDir? } (tests inject the fake app).
 */
export async function runAccount(ctx, deps = {}) {
  const connect = deps.connectApp ?? (await import("../harness/app.mjs")).connectApp;
  const world = await ctx.getWorld();
  let ctrl;
  try {
    ctrl = await connect({ portsEnv: ctx.portsEnv, runDir: ctx.runDir, apiOrigin: ctx.apiOrigin });
  } catch (err) {
    const outcome = unavailable(err);
    if (outcome) return outcome;
    throw err;
  }
  try {
    const multiOrg = world.user("M").multiOrg;
    const seeded = multiOrg?.status === "SEEDED";
    const orgX = world.org("X");
    const orgY = world.org("Y");
    const stamp = deps.stamp ?? Date.now().toString(36);
    const orgRecord = { multiOrg };
    const blockedStep = () => ctx.block(multiOrg?.blocker ?? "", BLOCK_OWNER);
    const viewerKey = seeded ? "M" : "A";

    if (seeded) {
      const M = world.user("M");
      await ctx.step("signIn:orgChoice", async () => {
        const signed = await ctrl.signIn(M, { expectOrgChoice: true });
        orgRecord.signIn = {
          orgChoiceShown: signed.orgChoiceShown,
          orgApiCallsBeforeChoice: signed.orgApiCallsBeforeChoice,
          orgIds: (signed.status?.orgs ?? []).map((o) => o.id),
          expectedOrgIds: [orgX.id, orgY.id],
        };
        return { details: { ...orgRecord.signIn, sessionBinExists: signed.sessionBinExists } };
      });
      await ctx.step("selectOrg:Y", async () => {
        const status = await ctrl.selectOrg(orgY.id);
        orgRecord.choose = { orgId: status?.org?.id ?? null, expectedOrgId: orgY.id, needsOrgChoice: Boolean(status?.needsOrgChoice) };
        return { details: { ...orgRecord.choose } };
      });
      await ctx.step("reSignIn:remembered", async () => {
        await ctrl.signOut();
        const again = await ctrl.signIn(M);
        orgRecord.resignIn = { orgChoiceShown: again.orgChoiceShown, orgId: again.status?.org?.id ?? null, expectedOrgId: orgY.id };
        return { details: { ...orgRecord.resignIn } };
      });
      await ctx.step("selectOrg:X", async () => {
        const status = await ctrl.selectOrg(orgX.id);
        if (status?.org?.id !== orgX.id) throw new Error(`the app did not switch to organization X (works in ${status?.org?.id ?? "none"})`);
        return { details: { orgId: orgX.id } };
      });
    } else {
      for (const name of ["signIn:orgChoice", "selectOrg:Y", "reSignIn:remembered", "selectOrg:X"]) await ctx.step(name, blockedStep);
      await ctx.step("signIn:library", async () => {
        await ctrl.signIn(world.user("A"));
        return { details: { viewerKey } };
      });
    }

    const docsRecord = await gatherLibrary(ctx, {
      ctrl,
      world,
      viewerKey,
      stamp,
      userDataDir: deps.userDataDir,
      pollMs: deps.pollMs,
      waitMs: deps.waitMs,
      sleep: deps.sleep,
    });

    if (seeded) {
      await ctx.step("deactivate", async () => {
        const w1 = world.workspace("X", "W1");
        const done = await world.deactivate("A", "X", world.user("M").id);
        const list = await ctrl.aiOffice("uniworkListWorkspaces");
        const create = await ctrl.aiOffice("uniworkCreateDocument", { workspaceId: w1.id, folderId: null, name: `G8-A09 ${stamp} locked`, format: "docx" });
        orgRecord.deactivated = {
          deactivateStatus: done?.status ?? null,
          listWorkspacesError: list?.ok ? null : (list?.error ?? "no answer"),
          createError: create?.ok ? null : (create?.error ?? "no answer"),
        };
        return { details: { ...orgRecord.deactivated } };
      });
    } else {
      await ctx.step("deactivate", blockedStep);
    }

    const orgDecision = decideG8A09Org(orgRecord);
    const docsDecision = decideG8A09Docs(docsRecord);
    await decisionStep(ctx, "decide:org", orgDecision);
    await decisionStep(ctx, "decide:docs", docsDecision);
    return { ...decideG8A09(orgDecision, docsDecision), details: { org: orgRecord, docs: docsRecord } };
  } finally {
    await ctrl.close();
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("account", (ctx) => runAccount(ctx)));

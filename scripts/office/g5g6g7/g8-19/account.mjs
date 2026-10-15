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
// run-row.mjs clips an artifact reason at 240 characters (redactSignInError); a reason is built to fit, never to be cut
const REASON_BUDGET = 236;
const PRODUCT_OWNER = "lead-f (fork uniwork-auth, G8-16); D only if the contract is to change";

function check(ok, detail, extra = {}) {
  return { ok: Boolean(ok), detail: String(detail), ...extra };
}

const is2xx = (status) => Number.isInteger(status) && status >= 200 && status < 300;

/** `'home:account-select-org': TransportError: uniwork request failed: malformed_response` -> `home:account-select-org: malformed_response` */
function appError(message) {
  const text = String(message ?? "").replace(/\s+/g, " ").trim();
  const m = /remote method '([^']+)': (?:TransportError: )?(?:uniwork request failed: )?(.*)$/.exec(text);
  return m ? `${m[1]}: ${m[2]}` : text.replace(/^page\.evaluate: (?:Error: )?/, "");
}

/**
 * Items that fit `budget` characters: whole items while they fit, then `+N more`
 * (with the names of the rest when those fit too). Never cuts an item in the middle.
 */
export function compactItems(items, budget) {
  const all = items.map(String);
  const joined = all.join("; ");
  if (joined.length <= budget) return joined;
  const nameOf = (item) => item.split(":")[0];
  const marker = (rest) => {
    const named = `+${rest.length} more (${rest.map(nameOf).join(", ")})`;
    return named.length <= 60 ? named : `+${rest.length} more`;
  };
  const out = [];
  for (const item of all) {
    const rest = all.slice(out.length + 1);
    const tail = rest.length > 0 ? `; ${marker(rest)}` : "";
    if ([...out, item].join("; ").length + tail.length > budget) break;
    out.push(item);
  }
  if (out.length === 0) out.push(nameOf(all[0]).slice(0, Math.max(8, budget - 12)));
  const rest = all.slice(out.length);
  return rest.length > 0 ? `${out.join("; ")}; ${marker(rest)}` : out.join("; ");
}

/**
 * What a rejected selectOrg means, from the app's error and a probe of D's own
 * answer (`probe`: { status, keys, membershipKeys } or { status: 0, error }; keys only, never values).
 * Returns { verdict: "product" | "undecided", short, finding, owner }.
 */
export function diagnoseSelectOrgError({ message, probe }) {
  const malformed = /malformed_response/.test(String(message ?? ""));
  const keys = Array.isArray(probe?.keys) ? probe.keys : null;
  const facts = probe?.status ? `D answered ${probe.status} with keys [${(keys ?? []).join(", ")}]${Array.isArray(probe.membershipKeys) ? ` and membership keys [${probe.membershipKeys.join(", ")}]` : ""}` : `the probe of D failed${probe?.error ? ` (${String(probe.error).slice(0, 80)})` : ""}`;
  if (malformed && probe?.status === 200 && keys && keys.includes("role") && !keys.includes("membership")) {
    return {
      verdict: "product",
      short: "product: fork parseOrgMembership wants {membership:{role}}, D members/me answers flat {role}",
      finding:
        `product: the app's selectOrg reads GET /api/v1/orgs/{org}/members/me for the chosen org; the fork's parseOrgMembership (apps/shell/src/main/uniwork-auth/transport.ts:239-241, pin 7d665a54) requires {membership:{role}} and throws malformed_response, ` +
        `while D answers a flat body (server/internal/handler/organization_members.go:67-76, dto/sdo/people.go:29-33): ${facts}. ` +
        `No organization can be picked, so the remembered org, the library in X and the deactivated list cannot be judged.`,
      owner: PRODUCT_OWNER,
    };
  }
  return {
    verdict: "undecided",
    short: "undecided: see details.org.finding",
    finding: `undecided: selectOrg was rejected (${appError(message)}); ${facts}.`,
    owner: "",
  };
}

/** GET /api/v1/orgs/{slug}/members/me as the member, reduced to status and key names (no values, no token) */
export async function probeOrgMembership({ apiOrigin, token, slug, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${apiOrigin}/api/v1/orgs/${encodeURIComponent(slug)}/members/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    const isObject = body && typeof body === "object" && !Array.isArray(body);
    return {
      status: res.status,
      keys: isObject ? Object.keys(body) : null,
      membershipKeys: isObject && body.membership && typeof body.membership === "object" ? Object.keys(body.membership) : null,
    };
  } catch (err) {
    return { status: 0, error: String(err?.message ?? err).slice(0, 120) };
  }
}

/**
 * The verdict for the account half. `record`:
 *   multiOrg    { status: "SEEDED" | "BLOCKED", blocker? }   from the world (M)
 *   signIn      { orgChoiceShown, orgApiCallsBeforeChoice, orgIds, expectedOrgIds }
 *   choose      { orgId, expectedOrgId, needsOrgChoice, error? }  the status after accountSelectOrg; `error` when the app rejected the call
 *   chooseX     { error? }                                   the same for the switch to X
 *   finding     diagnoseSelectOrgError() result, when a pick was rejected
 *   resignIn    { orgChoiceShown, orgId, expectedOrgId }    the status after sign-out + sign-in
 *   deactivated { deactivateStatus, listWorkspacesError, createError }
 * Returns { status: "PASS" | "FAIL" | "BLOCKED", reason, blocker?, owner?, checks, items }.
 * A check that cannot hold because no organization could be picked is `notJudged`:
 * it still fails the row but stays out of the reason (the rejection is the finding).
 * BLOCKED only while the second org could not be seeded, and only with the
 * world's named blocker; anything else that is not true is FAIL.
 */
export function decideG8A09Org(record) {
  const r = record ?? {};
  const multi = r.multiOrg;
  if (multi?.status === "BLOCKED") {
    const blocker = String(multi.blocker ?? "").trim();
    return blocker
      ? { status: "BLOCKED", reason: `second organization not seeded: ${blocker}`, blocker, owner: BLOCK_OWNER, checks: {}, items: [] }
      : { status: "FAIL", reason: "BLOCKED without a named blocker (world.users.M.multiOrg has none)", checks: {}, items: [] };
  }
  if (multi?.status !== "SEEDED") return { status: "FAIL", reason: "the world did not report whether M has two organizations", checks: {}, items: [] };

  const signIn = r.signIn ?? {};
  const choose = r.choose ?? {};
  const resign = r.resignIn ?? {};
  const off = r.deactivated ?? {};
  const noOrg = Boolean(choose.error || r.chooseX?.error);
  const checks = {};

  checks.choiceShown = check(signIn.orgChoiceShown === true, `org choice ${signIn.orgChoiceShown === true ? "shown" : "not shown"} for an account with two organizations`);
  const missing = (signIn.expectedOrgIds ?? []).filter((id) => !(signIn.orgIds ?? []).includes(id));
  checks.choiceListsBothOrgs = check((signIn.expectedOrgIds ?? []).length > 0 && missing.length === 0, missing.length === 0 ? `the picker lists ${(signIn.orgIds ?? []).length} organization(s)` : `the picker misses ${missing.join(", ")}`);
  const calls = signIn.orgApiCallsBeforeChoice;
  checks.noOrgCallBeforeChoice = check(calls === 0, calls === 0 ? "0 org-scoped requests before the choice" : calls == null ? "org-scoped requests before the choice are not measurable (no server log)" : `${calls} org-scoped request(s) before the choice`);

  const primary = [];
  if (choose.error) {
    const why = `selectOrg:Y rejected by the app: ${appError(choose.error)}`;
    checks.pickApplied = check(false, why);
    primary.push(r.finding?.short ? `${why} => ${r.finding.short}` : why);
  } else {
    checks.pickApplied = check(choose.orgId != null && choose.orgId === choose.expectedOrgId && choose.needsOrgChoice === false, `after the pick the app works in ${choose.orgId ?? "no organization"} (expected ${choose.expectedOrgId})`);
  }
  const unjudged = (detail) => check(false, `not judged: ${detail}`, { notJudged: true });
  const pickFailed = "no organization could be selected (see pickApplied)";
  checks.rememberedNoStep = choose.error ? unjudged(pickFailed) : check(resign.orgChoiceShown === false, `re-sign-in ${resign.orgChoiceShown === false ? "asks nothing" : "shows the picker again"}`);
  checks.rememberedOrgUsed = choose.error ? unjudged(pickFailed) : check(resign.orgId != null && resign.orgId === resign.expectedOrgId, `re-sign-in works in ${resign.orgId ?? "no organization"} (expected ${resign.expectedOrgId})`);

  const deactivated = is2xx(off.deactivateStatus);
  const why = `deactivate answered ${off.deactivateStatus ?? "nothing"}`;
  if (!deactivated) checks.deactivatedLibraryRefused = check(false, why);
  else if (off.listWorkspacesError === DEACTIVATED) checks.deactivatedLibraryRefused = check(true, `workspace list for a deactivated member answered ${DEACTIVATED} (expected ${DEACTIVATED})`);
  else if (noOrg) checks.deactivatedLibraryRefused = unjudged("the app works in no organization, so its workspace list never asks D");
  else checks.deactivatedLibraryRefused = check(false, `workspace list for a deactivated member answered ${off.listWorkspacesError ?? "ok"} (expected ${DEACTIVATED})`);
  checks.deactivatedCreateRefused = deactivated ? check(off.createError === DEACTIVATED, `create for a deactivated member answered ${off.createError ?? "ok"} (expected ${DEACTIVATED})`) : check(false, why);

  const failed = Object.entries(checks).filter(([name, c]) => !c.ok && !c.notJudged && !(name === "pickApplied" && choose.error));
  const items = [...primary, ...failed.map(([name, c]) => `${name}: ${c.detail}`)];
  const owner = r.finding?.verdict === "product" ? r.finding.owner : "";
  const anyFailed = Object.values(checks).some((c) => !c.ok);
  return anyFailed
    ? { status: "FAIL", reason: compactItems(items, REASON_BUDGET), checks, items, ...(owner ? { owner } : {}) }
    : { status: "PASS", reason: "", checks, items: [] };
}

/**
 * The row verdict from the two halves: FAIL beats BLOCKED beats PASS. The FAIL
 * reason shares REASON_BUDGET between the failed halves (a short half gives its
 * unused room away) and is built from whole items, so no check is cut off.
 */
export function decideG8A09(org, docs) {
  const parts = [
    ["org", org],
    ["docs", docs],
  ];
  const failed = parts.filter(([, d]) => d?.status !== "PASS" && d?.status !== "BLOCKED");
  if (failed.length > 0) {
    const separator = " | ";
    let room = REASON_BUDGET - separator.length * (failed.length - 1);
    const sized = failed
      .map(([name, d]) => ({ name, items: d?.items?.length ? d.items : String(d?.reason || d?.status || "no verdict").split("; ") }))
      .map((p) => ({ ...p, full: `${p.name}: ${p.items.join("; ")}` }))
      .sort((a, b) => a.full.length - b.full.length);
    const budgets = new Map();
    sized.forEach((p, i) => {
      const share = Math.floor(room / (sized.length - i));
      const used = Math.min(p.full.length, share);
      budgets.set(p.name, used);
      room -= used;
    });
    const reason = failed
      .map(([name]) => {
        const p = sized.find((x) => x.name === name);
        return `${name}: ${compactItems(p.items, budgets.get(name) - name.length - 2)}`;
      })
      .join(separator);
    const owner = [...new Set(failed.map(([, d]) => d?.owner).filter(Boolean))].join(", ");
    return { status: "FAIL", reason, ...(owner ? { owner } : {}) };
  }
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
 * pollMs?, waitMs?, sleep?, userDataDir?, probeMembership? } (tests inject the fake app and the probe).
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
      const diagnose = async (org, error) => {
        if (orgRecord.finding) return;
        const probe = await (deps.probeMembership ?? probeOrgMembership)({ apiOrigin: ctx.apiOrigin, token: M.token, slug: org.slug });
        orgRecord.finding = { ...diagnoseSelectOrgError({ message: error, probe }), probe };
        await ctx.step("diagnose:selectOrg", async () => ({ details: { ...orgRecord.finding } }));
      };
      orgRecord.choose = { orgId: null, expectedOrgId: orgY.id, needsOrgChoice: null };
      const pickedY = await ctx.step("selectOrg:Y", async () => {
        try {
          const status = await ctrl.selectOrg(orgY.id);
          orgRecord.choose = { orgId: status?.org?.id ?? null, expectedOrgId: orgY.id, needsOrgChoice: Boolean(status?.needsOrgChoice) };
        } catch (err) {
          orgRecord.choose.error = err instanceof Error ? err.message : String(err);
          throw err;
        }
        return { details: { ...orgRecord.choose } };
      });
      if (pickedY.status !== "PASS" && orgRecord.choose.error) await diagnose(orgY, orgRecord.choose.error);
      await ctx.step("reSignIn:remembered", async () => {
        await ctrl.signOut();
        const again = await ctrl.signIn(M);
        orgRecord.resignIn = { orgChoiceShown: again.orgChoiceShown, orgId: again.status?.org?.id ?? null, expectedOrgId: orgY.id };
        return { details: { ...orgRecord.resignIn } };
      });
      const pickedX = await ctx.step("selectOrg:X", async () => {
        let status;
        try {
          status = await ctrl.selectOrg(orgX.id);
        } catch (err) {
          orgRecord.chooseX = { error: err instanceof Error ? err.message : String(err) };
          throw err;
        }
        if (status?.org?.id !== orgX.id) {
          orgRecord.chooseX = { error: `the app did not switch to organization X (works in ${status?.org?.id ?? "none"})` };
          throw new Error(orgRecord.chooseX.error);
        }
        return { details: { orgId: orgX.id } };
      });
      if (pickedX.status !== "PASS" && orgRecord.chooseX?.error) await diagnose(orgX, orgRecord.chooseX.error);
    } else {
      for (const name of ["signIn:orgChoice", "selectOrg:Y", "reSignIn:remembered", "selectOrg:X"]) await ctx.step(name, blockedStep);
      await ctx.step("signIn:library", async () => {
        await ctrl.signIn(world.user("A"));
        return { details: { viewerKey } };
      });
    }

    const noOrgX = Boolean(orgRecord.chooseX?.error);
    const docsRecord = noOrgX
      ? { skipped: `the app could not select organization X: ${appError(orgRecord.chooseX.error)}` }
      : await gatherLibrary(ctx, {
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
    const docsDecision = noOrgX
      ? { status: "FAIL", reason: "not judged (no organization selected)", items: ["not judged (no organization selected)"], checks: {} }
      : decideG8A09Docs(docsRecord);
    await decisionStep(ctx, "decide:org", orgDecision);
    await decisionStep(ctx, "decide:docs", docsDecision);
    return { ...decideG8A09(orgDecision, docsDecision), details: { org: orgRecord, docs: docsRecord } };
  } finally {
    await ctrl.close();
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("account", (ctx) => runAccount(ctx)));

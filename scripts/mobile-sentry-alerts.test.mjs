import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RULES_FILE, drift, extraActions, issueBody, main, metricBody, sync } from "./mobile-sentry-alerts.mjs";

const root = path.resolve(import.meta.dirname, "..");
const rules = JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
const ENV = { SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "uniai", SENTRY_PROJECT: "unichat-mobile", SENTRY_ALERT_TEAM: "mobile" };

/** A Sentry with one team and the alert rules it holds; records every write. */
function fakeSentry({ metric = [], issue = [], teamStatus = 200 } = {}) {
  const writes = [];
  const state = { metric: structuredClone(metric), issue: structuredClone(issue) };
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const p = new URL(url).pathname.replace("/api/0", "");
    const reply = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)) });
    if (p === "/teams/uniai/mobile/") return teamStatus === 200 ? reply(200, { id: "42", slug: "mobile" }) : reply(teamStatus, "<html>");
    const kind = p === "/organizations/uniai/alert-rules/" || p.startsWith("/organizations/uniai/alert-rules/") ? "metric" : p.startsWith("/projects/uniai/unichat-mobile/rules/") ? "issue" : null;
    if (!kind) return reply(404, { detail: "not found" });
    if (method === "GET") return reply(200, state[kind]);
    const body = JSON.parse(init.body);
    writes.push({ method, kind, name: body.name });
    if (method === "POST") state[kind].push({ ...body, id: String(state[kind].length + 1) });
    else state[kind] = state[kind].map((r) => (p.endsWith(`/${r.id}/`) ? { ...body, id: r.id } : r));
    return reply(200, body);
  };
  return { fetchImpl, writes, state };
}

test("the rules as code are the ones the runbooks name, each pointing at a runbook that exists", () => {
  assert.deepEqual(rules.metric.map((r) => [r.environment, r.critical]), [["production", 99.5], ["production", 3000]], "the runbook's crash-free floor and cold start");
  assert.equal(metricBody(rules.metric[1], { project: "p", teamId: "1", extra: [] }).query, "event.type:transaction");
  for (const rule of [...rules.metric, ...rules.issue]) {
    assert.ok(fs.existsSync(path.join(root, rule.runbook)), `${rule.name}: ${rule.runbook}`);
    assert.match(rule.name, /^UniChat mobile: /);
  }
  const launch = rules.issue.find((r) => /OTA/.test(r.name));
  assert.deepEqual(launch.filters, [{ id: "sentry.rules.filters.tagged_event.TaggedEventFilter", key: "ota_failure", match: "is" }], "the tag data/release/launch-health.ts sets");
});

test("each rule renders into Sentry's shape with the team and the pager actions", () => {
  const extra = extraActions(JSON.stringify({ metric: [{ type: "pagerduty", integrationId: 7, targetIdentifier: "svc" }], issue: [{ id: "x.Pager" }] }));
  const metric = metricBody(rules.metric[0], { project: "unichat-mobile", teamId: "42", extra: extra.metric });
  assert.equal(metric.owner, "team:42");
  assert.deepEqual(metric.projects, ["unichat-mobile"]);
  assert.deepEqual(metric.triggers.map((t) => [t.label, t.alertThreshold, t.actions.map((a) => a.type)]), [
    ["critical", 99.5, ["email", "pagerduty"]],
    ["warning", 99.8, ["email", "pagerduty"]],
  ]);
  assert.equal(metricBody({ ...rules.metric[0], warning: undefined }, { project: "p", teamId: "1", extra: [] }).triggers.length, 1);
  const issue = issueBody(rules.issue[0], { teamId: "42", extra: extra.issue });
  assert.deepEqual(issue.actions.map((a) => a.id), ["sentry.mail.actions.NotifyEmailAction", "x.Pager"]);
  assert.deepEqual(extraActions(""), { metric: [], issue: [] });
  assert.deepEqual(extraActions("{}"), { metric: [], issue: [] });
  assert.throws(() => extraActions("{"), /not JSON/);
  assert.throws(() => extraActions('{"metric": {}}'), /metric must be a list/);
  assert.throws(() => extraActions('{"issue": [1]}'), /issue must be a list/);
});

test("drift names the fields that differ and ignores the ones Sentry adds", () => {
  const want = metricBody(rules.metric[0], { project: "p", teamId: "1", extra: [] });
  assert.deepEqual(drift("metric", want, { ...want, id: "9", dateCreated: "x" }), []);
  assert.deepEqual(drift("metric", want, { ...want, timeWindow: 30, triggers: [{ label: "critical", alertThreshold: 99 }] }), ["timeWindow", "triggers"]);
  assert.deepEqual(drift("metric", want, { ...want, triggers: undefined }), ["triggers"]);
  const issue = issueBody(rules.issue[1], { teamId: "1", extra: [] });
  const named = { ...issue, conditions: issue.conditions.map((c) => ({ ...c, name: "Sentry's label" })) };
  assert.deepEqual(drift("issue", issue, named), [], "Sentry names each condition; the name is not ours");
  assert.deepEqual(drift("issue", issue, { ...issue, frequency: 5, filters: [] }), ["frequency", "filters"]);
  assert.deepEqual(drift("issue", issue, { ...issue, conditions: undefined }), ["conditions"]);
});

test("check reports, apply creates the missing rules and updates the drifted ones, and a second check is clean", async () => {
  const want = metricBody(rules.metric[0], { project: "unichat-mobile", teamId: "42", extra: [] });
  const sentry = fakeSentry({ metric: [{ ...want, id: "5", timeWindow: 10 }] });
  const out = [];
  const io = { fetchImpl: sentry.fetchImpl, log: (l) => out.push(l) };
  assert.equal(await main(["check"], { env: ENV, ...io }), 0, "drift alone is a warning");
  assert.match(out[0], /\*\*drifted \(timeWindow\)\*\* — metric: UniChat mobile: crash-free/);
  assert.match(out[0], /\*\*missing\*\* — issue: UniChat mobile: a new or returning crash/);
  assert.match(out[1], /::warning::4 Sentry alert rule\(s\) differ/);
  assert.equal(await main(["check", "--strict"], { env: ENV, ...io }), 1);
  assert.equal(sentry.writes.length, 0, "check writes nothing");

  assert.equal(await main(["apply"], { env: ENV, ...io }), 0);
  assert.deepEqual(sentry.writes.map((w) => [w.method, w.kind]), [["PUT", "metric"], ["POST", "metric"], ["POST", "issue"], ["POST", "issue"]]);
  assert.match(out.at(-1), /- updated — metric: .*docs\/runbooks\/UniChatMobileCrashes\.md/);
  out.length = 0;
  assert.equal(await main(["check", "--strict"], { env: ENV, ...io }), 0);
  assert.equal(out.length, 1);
  assert.doesNotMatch(out[0], /missing|drifted/);
});

test("the command refuses what it cannot do", async () => {
  const io = { fetchImpl: fakeSentry().fetchImpl, log: () => undefined };
  await assert.rejects(main(["sync"], { env: ENV, ...io }), /usage/);
  await assert.rejects(main(["check"], { env: { ...ENV, SENTRY_ALERT_TEAM: "" }, ...io }), /SENTRY_ALERT_TEAM not set: the alert rules cannot be checked/);
  await assert.rejects(main(["apply"], { env: { SENTRY_ORG: "o" }, ...io }), /SENTRY_AUTH_TOKEN, SENTRY_PROJECT, SENTRY_ALERT_TEAM not set: the alert rules cannot be applied/);
  await assert.rejects(main(["check"], { env: { ...ENV, SENTRY_URL: "https://sentry.example/" }, fetchImpl: fakeSentry({ teamStatus: 403 }).fetchImpl, log: () => undefined }), /Sentry GET \/teams\/\{org\}\/mobile\/ answered 403: <html>/);
  await assert.rejects(main(["check"], { env: { ...ENV, SENTRY_ALERT_TEAM: "nobody" }, ...io }), /answered 404: not found/);
  await assert.rejects(sync({ mode: "check", rules, project: "p", team: "t", extra: { metric: [], issue: [] }, call: async () => ({}) }), /team t has no id/);
  const empty = await sync({ mode: "check", rules: {}, project: "p", team: "t", extra: { metric: [], issue: [] }, call: async (method, p) => (p.startsWith("/teams/") ? { id: "1" } : null) });
  assert.deepEqual(empty, { lines: [], pending: 0 });
});

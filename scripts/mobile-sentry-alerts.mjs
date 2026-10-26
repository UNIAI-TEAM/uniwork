#!/usr/bin/env node
// UniChat mobile's Sentry alert rules as code (audit "alerting-not-as-code": the crash-free alert was a runbook
// sentence asking someone to click it together, and nothing paged). The rules live in
// deploy/sentry/unichat-mobile-alerts.json; this renders each into Sentry's API shape and, by name:
//
//   check   lists each rule as ok, missing or drifted (and what drifted); exit 1 with --strict when any is not ok
//   apply   creates the missing rules and updates the drifted ones
//
// Every rule notifies the team SENTRY_ALERT_TEAM (its slug) by email, plus any pager the organization wired into
// Sentry (PagerDuty, Opsgenie, Slack…), given as Sentry action objects in SENTRY_ALERT_EXTRA_ACTIONS:
//   {"metric": [<metric alert trigger action>, …], "issue": [<issue alert action>, …]}
// env: SENTRY_AUTH_TOKEN (alerts:read to check, alerts:write to apply; project:read, team:read), SENTRY_ORG,
//      SENTRY_PROJECT, SENTRY_ALERT_TEAM, SENTRY_URL (optional), SENTRY_ALERT_EXTRA_ACTIONS (optional).
// .github/workflows/chat-mobile-release-health.yml checks every hour and applies when dispatched with sync_alerts.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RULES_FILE = path.resolve(import.meta.dirname, "../deploy/sentry/unichat-mobile-alerts.json");
const REPO = "https://github.com/UNIAI-TEAM/uniwork/blob/develop/";

export class AlertsError extends Error {}

/** Sentry's API for one organization: `call(method, path, body)` → parsed JSON. */
export function sentryApi({ org, token, url = "https://sentry.io", fetchImpl }) {
  const base = `${url.replace(/\/+$/, "")}/api/0`;
  return async (method, apiPath, body) => {
    const response = await fetchImpl(`${base}${apiPath.replace("{org}", encodeURIComponent(org))}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) throw new AlertsError(`Sentry ${method} ${apiPath.replace(/\/\d+\/$/, "/<id>/")} answered ${response.status}: ${json?.detail ?? text.slice(0, 200)}`);
    return json;
  };
}

/** The extra pager actions, checked: an object with optional `metric` and `issue` arrays of action objects. */
export function extraActions(raw) {
  if (!raw) return { metric: [], issue: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AlertsError("SENTRY_ALERT_EXTRA_ACTIONS is not JSON");
  }
  const list = (value, name) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((a) => a && typeof a === "object")) throw new AlertsError(`SENTRY_ALERT_EXTRA_ACTIONS.${name} must be a list of Sentry action objects`);
    return value;
  };
  return { metric: list(parsed?.metric, "metric"), issue: list(parsed?.issue, "issue") };
}

/** A metric alert rule in the API's shape. */
export function metricBody(rule, { project, teamId, extra }) {
  const actions = [{ type: "email", targetType: "team", targetIdentifier: String(teamId) }, ...extra];
  const trigger = (label, alertThreshold) => ({ label, alertThreshold, actions });
  return {
    name: rule.name,
    owner: `team:${teamId}`,
    dataset: rule.dataset,
    query: rule.dataset === "transactions" ? "event.type:transaction" : "",
    aggregate: rule.aggregate,
    timeWindow: rule.timeWindow,
    thresholdType: rule.thresholdType,
    resolveThreshold: null,
    environment: rule.environment,
    projects: [project],
    triggers: [trigger("critical", rule.critical), ...(rule.warning === undefined ? [] : [trigger("warning", rule.warning)])],
  };
}

/** An issue alert rule in the API's shape; its email says which runbook to open. */
export function issueBody(rule, { teamId, extra }) {
  return {
    name: rule.name,
    owner: `team:${teamId}`,
    environment: rule.environment,
    actionMatch: rule.actionMatch,
    filterMatch: rule.filterMatch,
    frequency: rule.frequency,
    conditions: rule.conditions,
    filters: rule.filters,
    actions: [{ id: "sentry.mail.actions.NotifyEmailAction", targetType: "Team", targetIdentifier: teamId, fallthroughType: "ActiveMembers" }, ...extra],
  };
}

const ids = (list) => (list ?? []).map((item) => JSON.stringify(Object.fromEntries(Object.entries(item).filter(([k]) => k !== "name").sort(([a], [b]) => a.localeCompare(b)))));

/** What differs between the rule as code and the rule Sentry has (the fields this file owns). */
export function drift(kind, want, have) {
  const out = [];
  if (kind === "metric") {
    for (const key of ["aggregate", "timeWindow", "thresholdType", "environment", "dataset"]) if (String(want[key]) !== String(have[key])) out.push(key);
    const thresholds = (rule) => (rule.triggers ?? []).map((t) => `${t.label}:${Number(t.alertThreshold)}`).sort().join(",");
    if (thresholds(want) !== thresholds(have)) out.push("triggers");
  } else {
    for (const key of ["environment", "actionMatch", "filterMatch", "frequency"]) if (String(want[key]) !== String(have[key])) out.push(key);
    if (ids(want.conditions).join() !== ids(have.conditions).join()) out.push("conditions");
    if (ids(want.filters).join() !== ids(have.filters).join()) out.push("filters");
  }
  return out;
}

export async function sync({ mode, rules, call, project, team, extra }) {
  const teamInfo = await call("GET", `/teams/{org}/${encodeURIComponent(team)}/`);
  const teamId = teamInfo?.id;
  if (!teamId) throw new AlertsError(`team ${team} has no id`);
  const lines = [];
  let pending = 0;
  const kinds = [
    {
      kind: "metric",
      list: "/organizations/{org}/alert-rules/",
      one: (id) => `/organizations/{org}/alert-rules/${id}/`,
      bodies: (rules.metric ?? []).map((r) => [r, metricBody(r, { project, teamId, extra: extra.metric })]),
    },
    {
      kind: "issue",
      list: `/projects/{org}/${encodeURIComponent(project)}/rules/`,
      one: (id) => `/projects/{org}/${encodeURIComponent(project)}/rules/${id}/`,
      bodies: (rules.issue ?? []).map((r) => [r, issueBody(r, { teamId, extra: extra.issue })]),
    },
  ];
  for (const { kind, list, one, bodies } of kinds) {
    const existing = (await call("GET", list)) ?? [];
    for (const [rule, body] of bodies) {
      const have = existing.find((e) => e.name === body.name);
      const differs = have ? drift(kind, body, have) : null;
      if (have && differs.length === 0) {
        lines.push(`- ok — ${kind}: ${body.name}`);
        continue;
      }
      const what = have ? `drifted (${differs.join(", ")})` : "missing";
      if (mode === "apply") {
        await (have ? call("PUT", one(have.id), body) : call("POST", list, body));
        lines.push(`- ${have ? "updated" : "created"} — ${kind}: ${body.name} (${REPO}${rule.runbook})`);
      } else {
        pending += 1;
        lines.push(`- **${what}** — ${kind}: ${body.name}`);
      }
    }
  }
  return { lines, pending };
}

export async function main(argv, { env = process.env, fetchImpl = fetch, log = console.log, rulesText } = {}) {
  const [mode, ...flags] = argv;
  if (mode !== "check" && mode !== "apply") throw new AlertsError(`usage: mobile-sentry-alerts.mjs check [--strict] | apply`);
  const missing = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_ALERT_TEAM"].filter((name) => !env[name]);
  if (missing.length) throw new AlertsError(`${missing.join(", ")} not set: the alert rules cannot be ${mode === "apply" ? "applied" : "checked"}`);
  const rules = JSON.parse(rulesText ?? fs.readFileSync(RULES_FILE, "utf8"));
  const call = sentryApi({ org: env.SENTRY_ORG, token: env.SENTRY_AUTH_TOKEN, url: env.SENTRY_URL || undefined, fetchImpl });
  const { lines, pending } = await sync({ mode, rules, call, project: env.SENTRY_PROJECT, team: env.SENTRY_ALERT_TEAM, extra: extraActions(env.SENTRY_ALERT_EXTRA_ACTIONS) });
  log(`### UniChat Sentry alert rules (${mode})\n\n${lines.join("\n")}\n`);
  if (pending) log(`::warning::${pending} Sentry alert rule(s) differ from deploy/sentry/unichat-mobile-alerts.json: dispatch the release-health workflow with sync_alerts`);
  return pending && flags.includes("--strict") ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error::${error instanceof Error ? error.message : error}`);
      process.exit(1);
    },
  );
}

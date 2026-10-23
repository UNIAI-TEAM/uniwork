#!/usr/bin/env node
// What the UniChat mobile workflows read from the repository's settings, and whether GitHub has it (audit "Testing &
// quality gates", missed P2: nothing checked that the nightly and the release pipelines were provisioned before
// their first scheduled run or release tag — the nightly needs seven MAESTRO_* settings, five environments did not
// exist, and the first failure would have been the tag). The list is read from the workflow files themselves, so a
// new `secrets.X` in a mobile workflow is checked the day it lands; nothing here is a second list to keep in sync.
//
// A name a job reads must exist at the repository level, or in the environment that job runs in. Each environment a
// job names must exist. Values are never read (GitHub never returns them); only names. Needs `gh auth login` as
// someone who may list the repository's secrets (an admin); CI never runs it.
//
//   node scripts/mobile-ci-provisioning.mjs          the table: every name, where it was found or that it is missing
//   node scripts/mobile-ci-provisioning.mjs --check  the same, and exit 1 when anything required is missing
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
export const REPOSITORY = "UNIAI-TEAM/uniwork";

/** The workflows that build, test, ship or watch UniChat mobile. */
export const WORKFLOWS = [
  "mobile-verify.yml",
  "chat-mobile-verify.yml",
  "chat-mobile-release.yml",
  "chat-mobile-production.yml",
  "chat-mobile-promote.yml",
  "chat-mobile-update.yml",
  "chat-mobile-release-health.yml",
  "chat-mobile-rollback.yml",
  "chat-mobile-device-farm.yml",
];

/** Names a workflow reads but may run without, each with why. */
export const OPTIONAL = {
  SENTRY_URL: "a self-hosted Sentry only; the default is https://sentry.io/",
  UNICHAT_RELEASE_HEALTH: "the switch that turns the hourly release-health run on; off until Sentry has data",
  SENTRY_ALERT_EXTRA_ACTIONS: "the pager actions Sentry's alert rules add to the team email; email only without it",
  ASC_KEY_ID: "iOS only: the App Store Connect API key, once the Apple Developer account exists (UNI-1838)",
  ASC_ISSUER_ID: "iOS only: the issuer of that key (UNI-1838)",
  ASC_PRIVATE_KEY: "iOS only: that key's .p8 (UNI-1838)",
  ASC_APP_ID: "iOS only: the app's Apple ID in App Store Connect (UNI-1838)",
  UNICHAT_HEALTH_MIN_SESSIONS: "a pilot's lower count for the release-health rules; the script's default without it",
  UNICHAT_HEALTH_SEVERE_MIN_SESSIONS: "as UNICHAT_HEALTH_MIN_SESSIONS",
  UNICHAT_HEALTH_MIN_CRASHED_USERS: "as UNICHAT_HEALTH_MIN_SESSIONS",
  UNICHAT_HEALTH_NEW_CRASH_MIN_USERS: "as UNICHAT_HEALTH_MIN_SESSIONS",
  UNICHAT_HEALTH_LAUNCH_FAILURE_MIN_USERS: "as UNICHAT_HEALTH_MIN_SESSIONS",
  UNICHAT_HEALTH_VITALS_MIN_USERS: "as UNICHAT_HEALTH_MIN_SESSIONS",
};

/** Names GitHub provides itself. */
const BUILT_IN = new Set(["GITHUB_TOKEN"]);

/**
 * Every `vars.X` and `secrets.X` a workflow's jobs read, with the environment the job runs in (null for none).
 * Jobs are the two-space-indented keys under `jobs:`; a name read outside any job (the workflow's env) counts for
 * every job's scope as the repository level.
 */
export function requirements(name, text) {
  const body = text.split(/^jobs:$/m)[1] ?? "";
  const head = text.split(/^jobs:$/m)[0] ?? "";
  const rows = [];
  const read = (chunk, job, environment) => {
    for (const [, kind, key] of chunk.matchAll(/\b(vars|secrets)\.([A-Z][A-Z0-9_]*)\b/g)) {
      if (!BUILT_IN.has(key)) rows.push({ workflow: name, job, environment, kind: kind === "vars" ? "variable" : "secret", name: key });
    }
  };
  read(head, "(workflow)", null);
  const parts = body.split(/^ {2}([\w-]+):\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const job = parts[i];
    const chunk = parts[i + 1] ?? "";
    const environment = chunk.match(/^ {4}environment:\s*(?:\n\s+name:\s*)?([\w-]+)\s*$/m)?.[1] ?? null;
    read(chunk, job, environment);
    if (environment) rows.push({ workflow: name, job, environment, kind: "environment", name: environment });
  }
  // One row per workflow, job, kind and name.
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.workflow}|${row.job}|${row.kind}|${row.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function allRequirements(root = ROOT) {
  return WORKFLOWS.flatMap((file) => requirements(file, fs.readFileSync(path.join(root, ".github/workflows", file), "utf8")));
}

/**
 * Where each requirement is met: `remote` is what GitHub has, by scope — `{ repo: { variables, secrets },
 * environments: { name: { variables, secrets } } }` (Sets of names; an environment absent from the map does not exist).
 */
export function audit(rows, remote) {
  return rows.map((row) => {
    if (row.kind === "environment") return { ...row, found: row.name in remote.environments ? "environment" : null };
    const plural = row.kind === "variable" ? "variables" : "secrets";
    const env = row.environment ? remote.environments[row.environment] : undefined;
    const found = env?.[plural]?.has(row.name) ? `environment ${row.environment}` : remote.repo[plural].has(row.name) ? "repository" : null;
    return { ...row, found, optional: row.name in OPTIONAL };
  });
}

function gh(endpoint) {
  return JSON.parse(execFileSync("gh", ["api", "--paginate", "--slurp", endpoint], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

/** GitHub's settings for the repository, by scope, as `audit` reads them. `api` answers `gh api --slurp` pages. */
export function fetchRemote(api = gh, repository = REPOSITORY) {
  const names = (pages, key) => new Set(pages.flatMap((page) => (page[key] ?? []).map((item) => item.name)));
  const environments = {};
  for (const environment of names(api(`repos/${repository}/environments`), "environments")) {
    environments[environment] = {
      variables: names(api(`repos/${repository}/environments/${environment}/variables`), "variables"),
      secrets: names(api(`repos/${repository}/environments/${environment}/secrets`), "secrets"),
    };
  }
  return {
    repo: { variables: names(api(`repos/${repository}/actions/variables`), "variables"), secrets: names(api(`repos/${repository}/actions/secrets`), "secrets") },
    environments,
  };
}

/** The report's lines and whether anything required is missing. */
export function report(results) {
  const missing = results.filter((r) => !r.found && !r.optional);
  const lines = results.map((r) => {
    const state = r.found ? `ok (${r.found})` : r.optional ? `optional: ${OPTIONAL[r.name]}` : "MISSING";
    return `${r.workflow} › ${r.job}${r.environment ? ` [${r.environment}]` : ""}  ${r.kind} ${r.name}: ${state}`;
  });
  lines.push(missing.length === 0 ? "Every required setting exists." : `${missing.length} required setting(s) missing: docs/runbooks/unichat-mobile-release.md › Thiết lập lần đầu.`);
  return { lines, ok: missing.length === 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const mode = process.argv[2];
  if (mode !== undefined && mode !== "--check") {
    console.error("usage: node scripts/mobile-ci-provisioning.mjs [--check]");
    process.exit(2);
  }
  const { lines, ok } = report(audit(allRequirements(), fetchRemote()));
  for (const line of lines) console.log(line);
  process.exit(mode === "--check" && !ok ? 1 : 0);
}

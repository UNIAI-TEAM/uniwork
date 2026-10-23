#!/usr/bin/env node
// Branch protection for main and develop, from scripts/branch-protection.json:
// the status checks a pull request must pass before it merges. Without it every
// check in .github/workflows is advisory and a red run merges (audit P0
// "no-branch-protection"). Needs a token with admin rights on the repository
// (`gh auth login` as an admin); CI never runs --apply.
//
//   node scripts/branch-protection.mjs --print   the request bodies, nothing sent
//   node scripts/branch-protection.mjs --apply   protect both branches (keeps any existing review rules)
//   node scripts/branch-protection.mjs --check   exit 1 when GitHub requires less than the file
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MANIFEST = path.join(import.meta.dirname, "branch-protection.json");

export function readManifest(file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** The required-checks part, as the REST API takes it. Not strict: a PR need not be rebased on every merge. */
export function requiredChecks(manifest) {
  return { strict: false, checks: manifest.contexts.map(({ context }) => ({ context })) };
}

/** The whole protection for a branch that has none: required checks, admins included, nothing else imposed. */
export function protectionBody(manifest) {
  return { required_status_checks: requiredChecks(manifest), enforce_admins: true, required_pull_request_reviews: null, restrictions: null };
}

/** The contexts the file requires that GitHub's answer does not. */
export function missingContexts(manifest, remote) {
  const have = new Set([...(remote?.contexts ?? []), ...(remote?.checks ?? []).map((c) => c.context)]);
  return manifest.contexts.map(({ context }) => context).filter((context) => !have.has(context));
}

function gh(args, input) {
  return execFileSync("gh", ["api", ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
}

function getJSON(endpoint) {
  try {
    return JSON.parse(gh([endpoint]));
  } catch (error) {
    if (/HTTP 404|Branch not protected/.test(String(error.stderr))) return null;
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const manifest = readManifest();
  const mode = process.argv[2];
  let failed = false;
  for (const branch of manifest.branches) {
    const base = `repos/${manifest.repository}/branches/${branch}/protection`;
    if (mode === "--print") {
      console.log(`PUT ${base} (when unprotected)\n${JSON.stringify(protectionBody(manifest), null, 2)}`);
      console.log(`PATCH ${base}/required_status_checks (when protected)\n${JSON.stringify(requiredChecks(manifest), null, 2)}`);
    } else if (mode === "--apply") {
      if (getJSON(base) === null) gh(["-X", "PUT", base, "--input", "-"], JSON.stringify(protectionBody(manifest)));
      else gh(["-X", "PATCH", `${base}/required_status_checks`, "--input", "-"], JSON.stringify(requiredChecks(manifest)));
      console.log(`${branch}: requires ${manifest.contexts.map((c) => c.context).join(", ")}`);
    } else if (mode === "--check") {
      const remote = getJSON(`${base}/required_status_checks`);
      const missing = remote === null ? ["(branch not protected)"] : missingContexts(manifest, remote);
      if (missing.length > 0) failed = true;
      console.log(`${branch}: ${missing.length === 0 ? "ok" : `missing ${missing.join(", ")}`}`);
    } else {
      console.error("usage: node scripts/branch-protection.mjs --print | --apply | --check");
      process.exit(2);
    }
  }
  process.exit(failed ? 1 : 0);
}

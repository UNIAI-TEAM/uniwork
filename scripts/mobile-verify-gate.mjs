#!/usr/bin/env node
// The one status check branch protection requires of UniChat mobile
// (scripts/branch-protection.json): mobile-verify.yml › gate, which runs after
// every other job of the workflow whatever they did (`if: always()`) and reads
// their results here.
//
// A job GitHub skips reports success to branch protection, so requiring the
// jobs themselves proves nothing: a scope job that crashed would skip the
// native builds and the PR would merge green. The gate knows which jobs the
// change needed (the scope job's mobile / native / ios outputs) and fails unless
// each of those succeeded; a job it did not need may only be skipped or pass.
//
//   NEEDS='${{ toJSON(needs) }}' node scripts/mobile-verify-gate.mjs
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Every job of mobile-verify.yml but the gate, and which scope output makes it required. */
export const JOBS = {
  scope: "always",
  checks: "mobile",
  "doctor-bundle": "mobile",
  "android-release": "native",
  "android-smoke": "native",
  // Its own output: the Android-only callers (the store release, the OTA update)
  // force the native build without iOS (mobile-verify.yml › inputs.ios).
  "ios-release": "ios",
};

/**
 * One row per job: whether the change needed it, what it did, and whether
 * that is acceptable. `needs` is the workflow's `toJSON(needs)`.
 */
export function verdict(needs) {
  const scope = needs.scope;
  const wanted = {
    always: true,
    mobile: scope?.outputs?.mobile === "true",
    native: scope?.outputs?.native === "true",
    ios: scope?.outputs?.ios === "true",
  };
  const rows = Object.entries(JOBS).map(([job, when]) => {
    const result = needs[job]?.result ?? "missing";
    // native or ios implies mobile: a binary is never built for a change the checks skip.
    const needed = wanted[when] || (when === "mobile" && (wanted.native || wanted.ios));
    const ok = needed ? result === "success" : result === "skipped" || result === "success";
    return { job, needed, result, ok };
  });
  for (const job of Object.keys(needs)) {
    if (!(job in JOBS)) rows.push({ job, needed: true, result: needs[job]?.result ?? "missing", ok: false, unknown: true });
  }
  return { ok: rows.every((row) => row.ok), rows };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { ok, rows } = verdict(JSON.parse(process.env.NEEDS ?? "{}"));
  const table = [
    "### UniChat mobile gate",
    "",
    "| job | needed | result | |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.job} | ${r.unknown ? "unknown to the gate" : r.needed ? "yes" : "no"} | ${r.result} | ${r.ok ? "ok" : "FAIL"} |`),
  ].join("\n");
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
  for (const r of rows.filter((row) => !row.ok)) {
    console.log(
      r.unknown
        ? `::error::job ${r.job} is not known to scripts/mobile-verify-gate.mjs: add it to JOBS`
        : `::error::job ${r.job} ${r.needed ? "was needed by this change and ended" : "ended"} ${r.result}`,
    );
  }
  process.exit(ok ? 0 : 1);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { JOBS, verdict } from "./mobile-verify-gate.mjs";

const scope = (mobile, native, result = "success") => ({ result, outputs: { mobile: String(mobile), native: String(native) } });
const all = (result) => Object.fromEntries(Object.keys(JOBS).filter((job) => job !== "scope").map((job) => [job, { result, outputs: {} }]));

test("a change outside the app passes with every check skipped", () => {
  assert.equal(verdict({ scope: scope(false, false), ...all("skipped") }).ok, true);
});

test("a JS-only change needs the checks and the bundle, not the native builds", () => {
  const needs = { scope: scope(true, false), ...all("skipped"), checks: { result: "success" }, "doctor-bundle": { result: "success" } };
  assert.equal(verdict(needs).ok, true);
  assert.equal(verdict({ ...needs, checks: { result: "skipped" } }).ok, false, "a needed job that was skipped fails");
  assert.equal(verdict({ ...needs, "doctor-bundle": { result: "failure" } }).ok, false);
});

test("a native change needs every job to succeed", () => {
  assert.equal(verdict({ scope: scope(true, true), ...all("success") }).ok, true);
  for (const job of ["android-release", "android-smoke"]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      assert.equal(verdict({ scope: scope(true, true), ...all("success"), [job]: { result } }).ok, false, `${job} ${result}`);
    }
  }
  // native implies mobile, whatever the scope said about mobile.
  assert.equal(verdict({ scope: scope(false, true), ...all("success"), checks: { result: "skipped" } }).ok, false);
});

test("a scope job that failed, or a job the gate does not know, fails the gate", () => {
  assert.equal(verdict({ scope: scope(false, false, "failure"), ...all("skipped") }).ok, false, "a crashed scope job must not pass for 'nothing to do'");
  assert.equal(verdict({ ...all("skipped") }).ok, false, "no scope job at all");
  assert.equal(verdict({ scope: scope(false, false), ...all("skipped"), "ios-smoke": { result: "skipped" } }).ok, false);
  assert.equal(verdict({ scope: scope(true, true), ...all("success"), checks: { result: "cancelled" } }).ok, false);
  // Not needed, still red: a job that ran and failed is never ignored.
  assert.equal(verdict({ scope: scope(false, false), ...all("skipped"), checks: { result: "failure" } }).ok, false);
});

test("the CLI exits 1 on a red verdict and names the job", () => {
  const script = path.join(import.meta.dirname, "mobile-verify-gate.mjs");
  const run = (needs) => {
    try {
      return { status: 0, out: execFileSync("node", [script], { env: { ...process.env, GITHUB_STEP_SUMMARY: "", NEEDS: JSON.stringify(needs) }, encoding: "utf8" }) };
    } catch (error) {
      return { status: error.status, out: String(error.stdout) };
    }
  };
  assert.equal(run({ scope: scope(false, false), ...all("skipped") }).status, 0);
  const red = run({ scope: scope(true, true), ...all("success"), "android-smoke": { result: "failure" } });
  assert.equal(red.status, 1);
  assert.match(red.out, /::error::job android-smoke was needed by this change and ended failure/);
});

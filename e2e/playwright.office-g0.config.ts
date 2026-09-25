// UNI-667 office-g0 browser acceptance config: the Markdown and HTML cycle slices
// (testMatch below). Separate from the product e2e config (e2e/playwright.config.ts),
// which this file never touches. A missing OFFICE_G0_LAB_URL/OFFICE_G0_FIXTURES_DIR/
// PLAYWRIGHT_OUTPUT_DIR, a non-loopback lab origin, or a fixture/artifact path outside
// the configured workspace is a named failure at config load, never a skip. The
// preview origin (OFFICE_G0_PREVIEW_URL) is an HTML-spec requirement validated at the
// start of the HTML test, not a shared-config requirement: a Markdown-only run must
// load this config and the Markdown spec without that variable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// URL.hostname keeps a bracketed IPv6 literal ("[::1]"), so both spellings are loopback.
const LOOPBACK = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

const required = (name: string, hint: string): string => {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new Error("[office-g0] " + name + " is required: " + hint);
  return value;
};

/** The workspace holding .uniwork-dev; this checkout is a worktree inside it. */
const WORKSPACE_ROOT = (() => {
  for (let dir = REPO_ROOT; ; ) {
    if (fs.existsSync(path.join(dir, ".uniwork-dev"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return REPO_ROOT;
    dir = parent;
  }
})();

const insideWorkspace = (name: string, raw: string): string => {
  const resolved = path.resolve(raw);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error("[office-g0] " + name + " must stay inside " + WORKSPACE_ROOT + ": " + resolved);
  }
  return resolved;
};

// This lab is loopback-only: refuse anything but this machine's http origin.
const labUrl = new URL(required("OFFICE_G0_LAB_URL", "the running lab, e.g. http://127.0.0.1:5390"));
if (labUrl.protocol !== "http:" || !LOOPBACK.has(labUrl.hostname)) {
  throw new Error("[office-g0] OFFICE_G0_LAB_URL must be a loopback http origin: " + labUrl.href);
}
if (labUrl.username !== "" || labUrl.password !== "") {
  throw new Error("[office-g0] OFFICE_G0_LAB_URL must not carry credentials: " + labUrl.href);
}
if (labUrl.pathname !== "/" || labUrl.search !== "" || labUrl.hash !== "") {
  throw new Error(
    "[office-g0] OFFICE_G0_LAB_URL must be a bare origin with no path, query or fragment: " + labUrl.href,
  );
}
const fixturesDir = insideWorkspace(
  "OFFICE_G0_FIXTURES_DIR",
  required("OFFICE_G0_FIXTURES_DIR", "absolute fixture directory the lab serves"),
);
const outputDir = insideWorkspace(
  "PLAYWRIGHT_OUTPUT_DIR",
  required("PLAYWRIGHT_OUTPUT_DIR", "absolute artifact directory inside the workspace"),
);

export default defineConfig({
  testDir: "office-g0",
  testMatch: ["markdown-cycle.spec.ts", "html-cycle.spec.ts", "docx-cycle.spec.ts"],
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  outputDir,
  // Historical shared filename, kept deliberately (not renamed): the Markdown slice, every
  // earlier HTML suffix on disk and main-extract-html-evidence.mjs still read
  // office-g0-markdown-report.json, so the HTML oracle keeps writing the same name.
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "office-g0-markdown-report.json") }]],
  use: {
    baseURL: labUrl.origin,
    locale: "en-US",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Installed Chrome and Edge only; WebKit is not Safari evidence (UNI-671).
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "edge", use: { ...devices["Desktop Edge"], channel: "msedge" } },
  ],
});

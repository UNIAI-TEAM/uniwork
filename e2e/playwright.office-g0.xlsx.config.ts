// UNI-667 (office-g0) XLSX browser-slice Playwright config.
//
// Wave2 runner contract: import the shared office-g0 config, so its loopback-only
// origin check, inside-workspace containment and required-env failures still apply,
// and override ONLY the testMatch and the JSON report name for the xlsx slice.
// Chrome and Edge, retries 0, workers 1, timeouts and trace/screenshot settings are
// inherited unchanged. This file never edits e2e/playwright.office-g0.config.ts or
// any shared spec.
//
// The shared config loads without OFFICE_G0_PREVIEW_URL; a preview origin is an
// HTML-spec requirement only, so the xlsx slice does not need it to load.
import path from "node:path";
import { defineConfig } from "@playwright/test";
import shared from "./playwright.office-g0.config";

const outputDir = String(shared.outputDir ?? "").trim();
if (outputDir.length === 0) {
  throw new Error("[office-g0-xlsx] the shared config did not resolve PLAYWRIGHT_OUTPUT_DIR");
}

// The slice runs exactly these installed browsers; naming them here keeps the runner's
// per-project report identity check independent of the shared project list.
export const XLSX_PROJECTS = ["chrome", "edge"];
const projects = XLSX_PROJECTS.map((name) => {
  const project = (shared.projects ?? []).find((entry) => entry.name === name);
  if (!project) throw new Error("[office-g0-xlsx] the shared office-g0 config is missing the " + name + " project");
  return project;
});

export default defineConfig({
  ...shared,
  testMatch: ["xlsx-cycle.spec.ts"],
  projects,
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "office-g0-xlsx-report.json") }]],
});

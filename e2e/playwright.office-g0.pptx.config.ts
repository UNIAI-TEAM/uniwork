// UNI-667 wave2 PPTX runner config. Imports the shared office-g0 Playwright config
// and overrides only testMatch to this format's spec, per parallel-wave2-contract.md.
// No edit to the shared config, the other format specs, or e2e/playwright.config.ts.
// Chrome and Edge, retries 0, workers 1 are inherited and asserted by the runner
// discovery gate. All required environment validation stays in the shared config.
import path from "node:path";
import { defineConfig } from "@playwright/test";
import shared from "./playwright.office-g0.config";

const outputDir = String(shared.outputDir ?? "").trim();
if (outputDir.length === 0) {
  throw new Error("[office-g0-pptx] the shared config did not resolve PLAYWRIGHT_OUTPUT_DIR");
}

export default defineConfig({
  ...shared,
  // testMatch is a list so the slice can load pptx-cycle.spec.ts and/or the separately
  // owned pptx-image-cycle.spec.ts. Which specs a run must prove is decided by the
  // runner's --spec-set: `full` (the default) requires both, while `image` deliberately
  // proves only the image spec. For the SELECTED set the runner requires every file on
  // disk and every name in the discovery listing, so a missing selected spec cannot
  // look like a silent pass; it does not additionally require an unselected spec.
  testMatch: ["pptx-cycle.spec.ts", "pptx-image-cycle.spec.ts"],
  reporter: [["list"], ["json", { outputFile: path.join(outputDir, "office-g0-pptx-report.json") }]],
});

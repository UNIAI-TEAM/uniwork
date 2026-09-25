// UNI-667 (office-g0) DOCX table-cycle browser-slice Playwright config.
//
// Imports the shared office-g0 config so its loopback-only origin check,
// inside-workspace containment and required-environment failures still apply,
// and overrides ONLY the test identity and the JSON report name for this slice.
// Chrome and Edge, retries 0, workers 1 and the inherited timeouts/trace/screenshot
// settings are unchanged. This file never edits e2e/playwright.office-g0.config.ts,
// any other slice config or any shared spec.
//
// testMatch names ONLY the new table-cycle spec. The accepted paragraph cycle
// (docx-cycle.spec.ts) is deliberately NOT listed: it is an unchanged accepted
// result and is not re-run to recreate history.
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import shared from './playwright.office-g0.config';

const outputDir = String(shared.outputDir ?? '').trim();
if (outputDir.length === 0) {
  throw new Error('[office-g0-docx-table] the shared config did not resolve PLAYWRIGHT_OUTPUT_DIR');
}

// The slice runs exactly these installed browsers; naming them here keeps the
// runner's per-project report identity check independent of the shared list.
export const DOCX_TABLE_PROJECTS = ['chrome', 'edge'];
const projects = DOCX_TABLE_PROJECTS.map((name) => {
  const project = (shared.projects ?? []).find((entry) => entry.name === name);
  if (!project) throw new Error('[office-g0-docx-table] the shared office-g0 config is missing the ' + name + ' project');
  return project;
});

export default defineConfig({
  ...shared,
  testMatch: ['docx-table-cycle.spec.ts'],
  projects,
  reporter: [['list'], ['json', { outputFile: path.join(outputDir, 'office-g0-docx-table-report.json') }]],
});

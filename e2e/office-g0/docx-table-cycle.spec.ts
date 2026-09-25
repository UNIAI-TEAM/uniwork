// UNI-667 DOCX TABLE cell edit, save and reopen cycle.
//
// This test drives the REAL docs renderer in a real browser. It opens the immutable
// G0 kitchen-sink fixture through the normal docs page bootstrap, clicks into ONE
// existing table cell (the fixture's A1 cell), types through the real keyboard into
// that cell, saves through the renderer's own Ctrl+S window shortcut, waits for the
// actual POST /lab/host:docs-save, closes that browser context, and reopens the
// PERSISTED bytes in a distinct fresh browser context/view.
//
// It never assigns a renderer global, never fabricates a session, never injects DOM
// or React state and never calls a host/engine save API from the test. The saved
// package is then handed to the independent scripts/office-g0/docx-table-oracle.mjs
// module, which reads the OOXML itself and answers whether the new text sits at the
// expected cell identity with the neighbours, paragraph text, media and document
// relationships intact.
//
// Required environment (named failure, never a skip):
//   OFFICE_G0_FIXTURES_DIR, OFFICE_G0_SOURCE_PIN, OFFICE_G0_BUILD_MANIFEST_SHA256
//   and testInfo.project.use.baseURL (the running lab origin).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
// @ts-expect-error - the oracle is a plain .mjs module without type declarations
import { assessDocxTableBytes } from '../../scripts/office-g0/docx-table-oracle.mjs';

const FIXTURE_NAME = 'g0-kitchen-sink.docx';
/** The fixture's own table text grid, read independently of the editor. */
const FIXTURE_CELLS = ['A1', 'B1', 'A2', 'B2'] as const;
/** Cell (table 0, row 0, col 0) holds 'A1'; that is the edited identity. */
const TARGET_CELL = { tableIndex: 0, row: 0, col: 0 } as const;
const NEIGHBOUR_CELLS = [
  { tableIndex: 0, row: 0, col: 1 },
  { tableIndex: 0, row: 1, col: 0 },
  { tableIndex: 0, row: 1, col: 1 },
] as const;
const CELL_EDIT_MARKER = 'A1-UNI667-TABLE-EDIT';
/** Selectors the read-only caret probe resolves inside the real page. */
// page.evaluate runs inside the page, so anything it needs is passed in as an
// argument rather than closed over. Quote characters are built from char codes
// so this source stays usable through the patch pipeline.
const DQ = String.fromCharCode(34);
const EDITOR_SELECTOR = String.fromCharCode(46) + 'ProseMirror' + '[' + 'contenteditable' + String.fromCharCode(61) + DQ + 'true' + DQ + ']';
const TABLE_SELECTOR = String.fromCharCode(46) + 'doc-table';
const CELL_TAG = 'td';
/** Paragraph text that must survive the cell edit untouched. */
const RETAINED_HEADING = '第一章 概述';
const RETAINED_PARAGRAPH = '普通段落,包含';
const RETAINED_TAIL = '尾段。';
const fixturesDir = (process.env.OFFICE_G0_FIXTURES_DIR ?? '').trim();
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

type Diagnostics = { transportFailures: string[]; consoleErrors: string[]; pageErrors: string[] };

type SessionOpen = {
  viewId: string;
  app: string;
  path: string;
  name: string;
  hash: string;
  size: number;
  workingPath: string;
};

type SaveResult = { ok: boolean; path: string; bytes: number; sha256: string; bytesMatch: boolean };

/** Record rather than hide every page, console and HTTP transport failure. */
function observe(page: Page): Diagnostics {
  const diagnostics: Diagnostics = { transportFailures: [], consoleErrors: [], pageErrors: [] };
  page.on('response', (response) => {
    if (response.status() >= 400) {
      diagnostics.transportFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    diagnostics.transportFailures.push(
      `REQUEST_FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`,
    );
  });
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error.message ?? error)));
  return diagnostics;
}

function isInside(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

/**
 * Reads where the editor OWN selection is. ProseMirror keeps
 * document.activeElement on the editor root while the caret sits inside a table
 * cell paragraph, so whether the cell owns the focus has to be answered from the
 * real DOM selection: which cell contains the selection anchor, and whether that
 * anchor is inside this editor. Nothing is written and no renderer state is assigned.
 */
async function caretInEditor(page: Page): Promise<{ editorFocused: boolean; cellIndex: number; insideEditor: boolean }> {
  return page.evaluate(
    (selectors: { editor: string; table: string; cell: string }) => {
      const active = document.activeElement;
      const root = document.querySelector(selectors.editor);
      const selection = window.getSelection();
      const anchor = selection && selection.anchorNode ? selection.anchorNode : null;
      const anchorElement =
        anchor && anchor.nodeType === Node.ELEMENT_NODE
          ? anchor
          : anchor && anchor.parentElement
            ? anchor.parentElement
            : null;
      const cell = anchorElement && anchorElement.closest ? anchorElement.closest(selectors.cell) : null;
      const tableEl = root ? root.querySelector(selectors.table) : null;
      const cells = tableEl ? Array.from(tableEl.querySelectorAll(selectors.cell)) : [];
      return {
        editorFocused: !!root && !!active && (active === root || root.contains(active)),
        cellIndex: cell ? cells.indexOf(cell) : -1,
        insideEditor: !!root && !!anchorElement && root.contains(anchorElement),
      };
    },
    { editor: EDITOR_SELECTOR, table: TABLE_SELECTOR, cell: CELL_TAG },
  );
}

/** Opens the fixture through the real docs bootstrap and asserts the session envelope. */
async function openFixture(page: Page, fixturePath: string, expectedHash: string): Promise<SessionOpen> {
  const sessionOpened = page.waitForResponse(
    (response) => response.url().includes('/lab/lab:session-open') && response.request().method() === 'POST',
  );
  await page.goto('/docs/?fixture=' + encodeURIComponent(fixturePath));
  const response = await sessionOpened;
  expect(response.ok(), 'lab:session-open HTTP status').toBe(true);
  const envelope = await response.json();
  expect(envelope.ok, 'lab:session-open envelope').toBe(true);
  const session = envelope.result as SessionOpen;
  expect(session.app).toBe('docs');
  expect(session.path).toBe(fixturePath);
  expect(session.hash).toBe(expectedHash);
  expect(session.viewId).toMatch(/^view-/);
  expect(session.workingPath).toBeTruthy();
  await expect(page.locator('body')).not.toContainText('lab host bootstrap failed');
  await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible();
  return session;
}

test('docs: edit an existing table cell, Ctrl+S, and reopen the persisted DOCX', async (
  { page, browser, browserName },
  testInfo,
) => {
  const fixturePath = path.join(fixturesDir, FIXTURE_NAME);
  const authoredBytes = fs.readFileSync(fixturePath);
  const authoredHash = sha256(authoredBytes);
  const firstRun = observe(page);

  const opened = await openFixture(page, fixturePath, authoredHash);
  const editor = page.locator('.ProseMirror[contenteditable="true"]');
  await expect(page).toHaveTitle(FIXTURE_NAME);
  await expect(editor).toContainText(RETAINED_HEADING);

  // One real table with the fixture's four cells, rendered by the pinned editor.
  const table = editor.locator('table.doc-table');
  await expect(table).toHaveCount(1);
  for (const cellText of FIXTURE_CELLS) await expect(table).toContainText(cellText);
  const originalImage = editor.locator('[data-doc-protected="image"] img.doc-protected-img');
  await expect(originalImage).toHaveCount(1);
  await expect
    .poll(() => originalImage.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
    .toBe(true);

  // A1 is the first body cell of the first row: a genuine existing cell, not a
  // synthesized node. Focus is asserted before any keyboard input.
  const targetCell = table.locator('tbody tr').nth(0).locator('td').nth(0);
  await expect(targetCell).toHaveCount(1);
  await expect(targetCell).toHaveText('A1');
  await targetCell.click();
  // The click is proven by the editor OWN selection landing in cell 0 of the
  // table, not by document.activeElement (ProseMirror keeps that on its root).
  await expect.poll(() => caretInEditor(page)).toEqual({ editorFocused: true, cellIndex: 0, insideEditor: true });
  const caretBeforeTyping = await caretInEditor(page);
  await page.keyboard.press('End');
  await page.keyboard.type(' ' + CELL_EDIT_MARKER);
  await expect(targetCell).toContainText(CELL_EDIT_MARKER);
  // The neighbouring cells still show their authored text before the save.
  await expect(table.locator('tbody tr').nth(0).locator('td').nth(1)).toHaveText('B1');
  await expect(table.locator('tbody tr').nth(1).locator('td').nth(0)).toHaveText('A2');
  await expect(table.locator('tbody tr').nth(1).locator('td').nth(1)).toHaveText('B2');

  const saveObserved = page.waitForResponse(
    (response) => response.url().includes('/lab/host:docs-save') && response.request().method() === 'POST',
  );
  // App.tsx window shortcut; not a host or engine call issued by this test.
  await page.keyboard.press('Control+s');
  const saveResponse = await saveObserved;
  expect(saveResponse.ok(), 'host:docs-save HTTP status').toBe(true);
  const saveEnvelope = await saveResponse.json();
  expect(saveEnvelope.ok, 'host:docs-save envelope').toBe(true);
  const saved = saveEnvelope.result as SaveResult;
  expect(saved.ok).toBe(true);
  expect(saved.bytes).toBeGreaterThan(0);
  expect(saved.bytesMatch, 'lab response confirms the persisted bytes match the request bytes').toBe(true);

  // Save must use the granted working copy, never the authored fixture.
  expect(path.resolve(saved.path)).toBe(path.resolve(opened.workingPath));
  expect(path.resolve(saved.path)).not.toBe(path.resolve(fixturePath));
  const viewRoot = path.resolve(opened.workingPath, '..', '..');
  expect(isInside(viewRoot, saved.path), 'saved file stays inside its server-minted view grant').toBe(true);

  const savedBytes = fs.readFileSync(saved.path);
  expect(savedBytes.length).toBe(saved.bytes);
  expect(sha256(savedBytes), 'the response hash is the bytes on disk').toBe(saved.sha256);
  expect(sha256(fs.readFileSync(fixturePath)), 'authored fixture remains immutable after save').toBe(authoredHash);

  // The independent oracle reads the persisted OOXML and decides the cell question.
  const oracle = assessDocxTableBytes({
    fixtureBytes: authoredBytes,
    savedBytes,
    identity: TARGET_CELL,
    newText: CELL_EDIT_MARKER,
    neighbourIdentities: [...NEIGHBOUR_CELLS],
    retainedParagraphTexts: [RETAINED_HEADING, RETAINED_PARAGRAPH, RETAINED_TAIL],
  });
  expect(oracle.checks, 'independent OOXML cell checks').toEqual(
    expect.objectContaining({
      targetHasNewText: true,
      savedDiffersFromFixtureBytes: true,
      neighboursUnchanged: true,
      namedNeighboursUnchanged: true,
      retainedParagraphsPresent: true,
      tableStructurePreserved: true,
      mediaByteEqual: true,
      relationshipsByteEqual: true,
    }),
  );
  expect(oracle.pass, 'independent OOXML cell oracle').toBe(true);

  await page.context().close();
  const configuredBase = testInfo.project.use.baseURL;
  if (!configuredBase) throw new Error('[office-g0] the project must provide use.baseURL for the reopened context');
  const reopenedContext = await browser.newContext({
    baseURL: new URL(configuredBase).origin,
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  });
  const reopenedPage = await reopenedContext.newPage();
  const secondRun = observe(reopenedPage);
  try {
    const reopened = await openFixture(reopenedPage, saved.path, sha256(savedBytes));
    // openFixture already binds the persisted PATH and HASH, so reopening the
    // authored fixture cannot pass. The distinct VIEW is asserted here rather
    // than only recorded: a lab that handed back the earlier session for the
    // same path would otherwise still satisfy the hash and DOM gates.
    expect(reopened.path).toBe(saved.path);
    expect(reopened.viewId).not.toBe(opened.viewId);
    expect(reopened.workingPath).not.toBe(opened.workingPath);
    expect(path.resolve(reopened.workingPath)).not.toBe(path.resolve(opened.workingPath));
    const reopenedEditor = reopenedPage.locator('.ProseMirror[contenteditable="true"]');
    await expect(reopenedPage).toHaveTitle(FIXTURE_NAME);
    const reopenedTable = reopenedEditor.locator('table.doc-table');
    await expect(reopenedTable).toHaveCount(1);
    // The edited cell shows the new text in the fresh session...
    await expect(reopenedTable.locator('tbody tr').nth(0).locator('td').nth(0)).toContainText(CELL_EDIT_MARKER);
    // ...and the neighbouring cells, heading, paragraph, tail and image survive.
    await expect(reopenedTable.locator('tbody tr').nth(0).locator('td').nth(1)).toHaveText('B1');
    await expect(reopenedTable.locator('tbody tr').nth(1).locator('td').nth(0)).toHaveText('A2');
    await expect(reopenedTable.locator('tbody tr').nth(1).locator('td').nth(1)).toHaveText('B2');
    await expect(reopenedEditor).toContainText(RETAINED_HEADING);
    await expect(reopenedEditor).toContainText(RETAINED_PARAGRAPH);
    await expect(reopenedEditor).toContainText(RETAINED_TAIL);
    const reopenedImage = reopenedEditor.locator('[data-doc-protected="image"] img.doc-protected-img');
    await expect(reopenedImage).toHaveCount(1);
    await expect
      .poll(() => reopenedImage.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
      .toBe(true);

    // Recorded, not assumed: every reopened cell is read back so the evidence
    // file carries what the fresh editor actually rendered.
    const reopenedCellText = {
      target: await reopenedTable.locator('tbody tr').nth(0).locator('td').nth(0).innerText(),
      b1: await reopenedTable.locator('tbody tr').nth(0).locator('td').nth(1).innerText(),
      a2: await reopenedTable.locator('tbody tr').nth(1).locator('td').nth(0).innerText(),
      b2: await reopenedTable.locator('tbody tr').nth(1).locator('td').nth(1).innerText(),
    };
    const markerInReopenedDom = reopenedCellText.target.includes(CELL_EDIT_MARKER);
    const neighboursIntactInReopenedDom =
      reopenedCellText.b1 === 'B1' && reopenedCellText.a2 === 'A2' && reopenedCellText.b2 === 'B2';

    const diagnostics: Diagnostics = {
      transportFailures: [...firstRun.transportFailures, ...secondRun.transportFailures],
      consoleErrors: [...firstRun.consoleErrors, ...secondRun.consoleErrors],
      pageErrors: [...firstRun.pageErrors, ...secondRun.pageErrors],
    };
    const diagnosticsClear =
      diagnostics.transportFailures.length === 0 &&
      diagnostics.consoleErrors.length === 0 &&
      diagnostics.pageErrors.length === 0;
    // Re-read and re-hash the PERSISTED output after the reopen, not the earlier buffer.
    const reopenedBytes = fs.readFileSync(saved.path);
    const reopenedOutputStable = sha256(reopenedBytes) === sha256(savedBytes);
    const authoredAfterReopen = fs.readFileSync(fixturePath);
    const authoredFixtureUnchanged = sha256(authoredAfterReopen) === authoredHash;
    const everyGatePassed =
      oracle.pass &&
      diagnosticsClear &&
      reopenedOutputStable &&
      authoredFixtureUnchanged &&
      markerInReopenedDom &&
      neighboursIntactInReopenedDom;

    // Durable on-disk evidence: Playwright keeps attachment FILES only for a
    // failed test, so the same payloads are also written under the run's own
    // artifact directory, named per browser, for the report to cite.
    const evidenceDir = (process.env.PLAYWRIGHT_OUTPUT_DIR ?? '').trim();
    if (evidenceDir.length === 0) {
      throw new Error('[office-g0] PLAYWRIGHT_OUTPUT_DIR is required to persist the cycle evidence');
    }
    // The PROJECT name is the per-run identity: browserName is chromium for both
    // the chrome and the edge channel, so naming the file by browserName would let
    // the second project silently overwrite the first one evidence.
    const runName = testInfo.project.name;
    const durable = path.join(evidenceDir, 'docx-table-cycle-evidence-' + runName + '.json');
    const screenshotPath = path.join(evidenceDir, 'docx-table-reopen-' + runName + '.png');
    const reopenedScreenshot = await reopenedPage.screenshot({ fullPage: true });
    fs.mkdirSync(evidenceDir, { recursive: true });

    await testInfo.attach('docx-table-reopen.png', {
      body: reopenedScreenshot,
      contentType: 'image/png',
    });
    const evidencePayload = JSON.stringify(
        {
          claim: everyGatePassed
            ? 'browser-real DOCX table cell open/edit/Ctrl+S/close/reopen completed every declared gate'
            : 'run did not pass every declared gate; see the oracle checks and diagnostics',
          runtime: {
            node: process.version,
            project: testInfo.project.name,
            browser: { name: browserName, version: browser.version() },
            os: { platform: process.platform, release: os.release(), arch: process.arch },
            labUrl: new URL(configuredBase).origin,
          },
          sourcePin: (process.env.OFFICE_G0_SOURCE_PIN ?? '').trim() || null,
          buildManifestSha256: (process.env.OFFICE_G0_BUILD_MANIFEST_SHA256 ?? '').trim() || null,
          fixture: {
            path: fixturePath,
            bytes: authoredBytes.length,
            sha256: authoredHash,
            sha256AfterSave: sha256(fs.readFileSync(fixturePath)),
            sha256AfterReopen: sha256(authoredAfterReopen),
            authoredTableText: [...FIXTURE_CELLS],
          },
          output: {
            path: saved.path,
            bytes: savedBytes.length,
            sha256: sha256(savedBytes),
            sha256AfterReopen: sha256(reopenedBytes),
            stableAfterReopen: reopenedOutputStable,
          },
          sessions: { initial: opened, reopened },
          saveResponse: saved,
          oracle,
          reopenedCellText,
          caretBeforeTyping,
          uiOperations:
            'GET /docs/?fixture=<authored path>; observed lab:session-open/hash; clicked the real cell (table 0,row 0,col 0) showing A1; asserted the editor own selection landed in that cell; End; typed the marker; observed the marker in the cell before saving; Ctrl+S; observed host:docs-save; re-read and hashed the persisted bytes; closed the context; opened the saved path in a fresh context; verified DOM, package and diagnostic gates',
          gates: {
            authoredFixtureUnchanged,
            oraclePass: oracle.pass,
            markerInReopenedDom,
            neighboursIntactInReopenedDom,
            diagnosticsClear,
            reopenedOutputStable,
          },
          diagnostics,
        },
        null,
        2,
      );
    fs.writeFileSync(durable, evidencePayload + '\n');
    fs.writeFileSync(screenshotPath, reopenedScreenshot);
    await testInfo.attach('docx-table-cycle-evidence.json', {
      body: evidencePayload,
      contentType: 'application/json',
    });

    expect(oracle.pass, 'independent OOXML oracle on the persisted bytes').toBe(true);
    expect(reopenedOutputStable, 'persisted output bytes/hash unchanged after reopen').toBe(true);
    expect(authoredFixtureUnchanged, 'authored fixture survives the reopen').toBe(true);
    expect(markerInReopenedDom, 'the reopened editor renders the new cell text').toBe(true);
    expect(neighboursIntactInReopenedDom, 'neighbouring cells keep their authored text in the reopened editor').toBe(true);
    expect(diagnostics.transportFailures, 'transport failures').toEqual([]);
    expect(diagnostics.pageErrors, 'page errors').toEqual([]);
    expect(diagnostics.consoleErrors, 'console errors').toEqual([]);
  } finally {
    await reopenedContext.close();
  }
});

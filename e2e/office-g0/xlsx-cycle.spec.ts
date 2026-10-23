// UNI-667 office-g0 XLSX reality cycle (r1; text proposal, UNEXECUTED).
//
// Opens the immutable g0-compatibility-edit.xlsx through the normal sheets page bootstrap,
// edits ONE existing cell (Data!A1) with real keyboard input into Univer, saves through the
// renderer's own Save command, waits for the actual POST /lab/host:sheets-save-edits, closes the
// browser context, reopens the persisted output in a FRESH context/view, asserts the edited
// value is visible there, and hands the persisted bytes to the independent xlsx output oracle
// wrapper. This spec never assigns a renderer global, never calls a host/engine save API, never
// fabricates a session, and never substitutes a JSON substring scan for a real value readback.
//
// Required environment (explicit failure, never a skip):
//   OFFICE_G0_FIXTURES_DIR, OFFICE_G0_SOURCE_PIN, OFFICE_G0_BUILD_MANIFEST_SHA256,
//   and testInfo.project.use.baseURL (the running lab origin).
//
// Integrated dependencies this spec CONSUMES (each now accepted and present; a missing one still fails loudly):
//   D1 scripts/office-g0/xlsx-output-oracle.mjs exporting verifyXlsxOutput - oracle 17/17, parked, no repeats.
//   D2 the lab save report: host:sheets-save-edits returns { status:'ok', savedPath, bytes, sha256 } for the
//      engine-published output under <lab>/out/<viewId> (publication B/C 9/9, resolver 37/37) - this spec
//      requires that exact shape and its canonical containment instead of trusting any distinct path.
//   D3 the renderer mount + workbook ready state that makes control.ts goto answer 'ok'; real keyboard focus
//      is additionally proven on the [data-u-comp='render-canvas'] canvas.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { verifyXlsxOutput } from "../../scripts/office-g0/xlsx-output-oracle.mjs";

const FIXTURE_NAME = "g0-compatibility-edit.xlsx";
const FIXTURE_SHA256 = "a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85";
const SHEET_NAME = "Data";
const TARGET_CELL = "A1";
const EDIT_MARKER = "UNI667-XLSX-EDIT";
// The recalc lane. C1 is the input Data!B3 = SUM(C1:C2) depends on, so editing it must make the
// engine recompute B3 and the save must persist B3's refreshed cached value WITH its formula.
const RECALC_INPUT_CELL = "C1";
const RECALC_INPUT_VALUE = "9";
const DEPENDENT_CELL = "B3";
const DEPENDENT_VALUE = "9";
const DEPENDENT_FORMULA = "SUM(C1:C2)";
// The reopened value readback is bounded, never an unbounded wait.
const READY_ATTEMPTS = 40;
const READY_DELAY_MS = 500;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

    const SOURCE_PIN = "09485f884dc845cf3bf27fb7edfe489f9d457aad";
    const SHA256_HEX = /^[0-9a-f]{64}$/;
    const CLIPBOARD_POLL_ATTEMPTS = 20;
    const CLIPBOARD_POLL_DELAY_MS = 150;

    /** The server-derived native output directory of ONE view, canonicalised as lab-storage does. */
    function nativeOutDir(labRoot: string, viewId: string): string {
      const outRoot = path.join(labRoot, "out");
      const outRootReal = fs.existsSync(outRoot) ? fs.realpathSync.native(outRoot) : outRoot;
      return path.join(outRootReal, viewId);
    }

    /** Lab-storage's accepted platform rule: NTFS and APFS fold case, other filesystems do not (lab-storage CASE_FOLD). */
    const CASE_FOLD = process.platform === "win32" || process.platform === "darwin";

    /** Lexical containment mirroring lab-storage's isLexicallyWithin, case-folded only where the platform folds case. */
    function isInsideDir(dir: string, target: string): boolean {
      const left = path.resolve(dir);
      const right = path.resolve(target);
      const a = CASE_FOLD ? left.toLowerCase() : left;
      const b = CASE_FOLD ? right.toLowerCase() : right;
      return b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
    }

    /**
     * Pinned sources that decide where grid keyboard focus actually is:
     *   * engine-render's Canvas constructor puts data-u-comp="render-canvas" and tabIndex = 1 on the
     *     <canvas> it creates (lib/es/index.js:4477-4478); that canvas is the element real key events reach; and
     *   * clear-selection-keyboard.ts isGridKeyTarget (lines 80-90) treats a contenteditable INSIDE
     *     #univer-container as Univer's hidden grid focus host, but never Univer chrome (formula bar, name
     *     box, panels, dialogs), a native field, or chrome outside the sheet container.
     * Exactly those two shapes pass. Any other #univer-container descendant (e.g. the name box
     * [data-u-comp="defined-name"]) is a FAILED focus proof, never an accepted one.
     */
    const GRID_CHROME_SELECTOR = [
      '[data-u-comp="formula-bar"]',
      '[data-u-comp="input"]',
      '[data-u-comp="textarea"]',
      '[data-u-comp="panel"]',
      '[data-u-comp="panel-field"]',
      '[data-u-comp="cell-popup"]',
      '[data-u-comp="defined-name"]',
      '[data-u-comp="defined-name-container"]',
      '[data-u-comp="select"]',
      '[data-u-comp="multiple-select"]',
      '[data-u-comp="sheets-dropdown-list"]',
      '[data-u-comp="gallery"]',
      '[data-u-comp="slide-tab-item"]',
      ".shape-editable",
      ".chart-editor",
      ".dialog-backdrop",
      '[role="dialog"]',
    ].join(", ");

    async function focusGrid(page: Page): Promise<void> {
      const canvas = page.locator('#univer-container canvas[data-u-comp="render-canvas"][tabindex="1"]').first();
      await expect(canvas, "the Univer render canvas is mounted").toBeVisible({ timeout: 30_000 });
      await canvas.focus();
      const focused = await page.evaluate((chromeSelector) => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return { ok: false, kind: "none", tag: "none", comp: null };
        const tag = active.tagName.toLowerCase();
        const comp = active.getAttribute("data-u-comp");
        const isRenderCanvas = tag === "canvas" && comp === "render-canvas" && active.tabIndex === 1;
        const isGridEditor =
          active.isContentEditable &&
          active.closest("#univer-container") !== null &&
          active.closest(chromeSelector) === null;
        return {
          ok: isRenderCanvas || isGridEditor,
          kind: isRenderCanvas ? "render-canvas" : isGridEditor ? "grid-editor" : "other",
          tag,
          comp,
        };
      }, GRID_CHROME_SELECTOR);
      expect(
        focused.ok,
        "keyboard focus is the exact render canvas or the grid editor " +
          "(kind=" + focused.kind + ", active=" + focused.tag + ", comp=" + focused.comp + ")",
      ).toBe(true);
    }

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
// The accepted central save report: lab-server.mjs host:sheets-save-edits returns
// { ...engineResult, status:'ok', savedPath, bytes, sha256 } for the server-proven published output.
type SaveReport = {
  status?: string;
  canceled?: boolean;
  savedPath?: string;
  bytes?: number;
  sha256?: string;
  saved?: { path?: string; bytes?: number; sha256?: string };
  file?: { path?: string; sha256?: string };
  touchedEntries?: unknown;
};
type ControlReply =
  | { status: "ok"; result: Record<string, unknown> }
  | { status: "not_ready" }
  | { status: "error"; error?: { reason?: string; message?: string } };
type SelectionResult = { sheet?: string; range?: string; values?: unknown; cells?: unknown };
// verifyXlsxOutput resolves to JSON evidence that carries its own ok gate plus the three hashes.
type OracleEvidence = {
  ok?: boolean;
  fixtureSha256?: string;
  savedSha256?: string;
  reopenedSha256?: string;
  [key: string]: unknown;
};

/** Fails by name instead of silently running with a missing required variable. */
function required(name: string, hint: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new Error("[office-g0] " + name + " is required: " + hint);
  return value;
}

/** Records rather than hides every page, console, request-failure and HTTP failure. */
function observe(page: Page): Diagnostics {
  const diagnostics: Diagnostics = { transportFailures: [], consoleErrors: [], pageErrors: [] };
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.transportFailures.push(response.status() + " " + response.request().method() + " " + response.url());
    }
  });
  page.on("requestfailed", (request) => {
    diagnostics.transportFailures.push(
      "REQUEST_FAILED " + request.method() + " " + request.url() + " " + (request.failure()?.errorText ?? ""),
    );
  });
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(String(error.message ?? error)));
  return diagnostics;
}

/**
 * Opens one lab page and returns the server-minted session. The view id is server-issued;
 * this test never invents one. The expected path/hash are asserted from the observed session.
 */
async function openFixture(page: Page, filePath: string, expectedHash: string): Promise<SessionOpen> {
  const sessionOpened = page.waitForResponse(
    (response) => response.url().includes("/lab/lab:session-open") && response.request().method() === "POST",
  );
  await page.goto("/sheets/?fixture=" + encodeURIComponent(filePath));
  const response = await sessionOpened;
  expect(response.ok(), "lab:session-open HTTP status").toBe(true);
  const envelope = await response.json();
  expect(envelope.ok, "lab:session-open envelope").toBe(true);
  const session = envelope.result as SessionOpen;
  expect(session.app, "lab session app").toBe("sheets");
  expect(session.path, "lab session path").toBe(filePath);
  expect(session.hash, "lab session pinned hash").toBe(expectedHash);
  expect(session.viewId, "server-minted view id").toMatch(/^view-/);
  expect(session.workingPath, "lab session working copy").toBeTruthy();
  await expect(page.locator("body")).not.toContainText("lab host bootstrap failed");
  return session;
}

/** Calls the renderer's own control surface (App.tsx:4188 / control.ts:34). No global is set here. */
async function control(page: Page, request: Record<string, unknown>): Promise<ControlReply> {
  return await page.evaluate(async (req) => {
    const fn = (window as unknown as Record<string, unknown>)["__genofficeControl"];
    if (typeof fn !== "function") {
      return { status: "error", error: { reason: "control_unavailable", message: "__genofficeControl is not installed" } };
    }
    return await (fn as (r: unknown) => Promise<ControlReply>)(req);
  }, request);
}

/**
 * Activates one cell through the renderer's control surface, retrying the documented
 * 'not_ready' reply with a fixed attempt budget. Any 'error' reply or an exhausted budget
 * fails by name; the wait is bounded and never silently skipped.
 */
async function selectCell(page: Page, reference: string): Promise<ControlReply> {
  let last: ControlReply = { status: "not_ready" };
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    last = await control(page, { cmd: "goto", target: { sheet: SHEET_NAME, range: reference } });
    if (last.status === "ok") return last;
    if (last.status === "error") {
      throw new Error("[office-g0] xlsx goto failed for " + SHEET_NAME + "!" + reference + ": " + JSON.stringify(last));
    }
    await page.waitForTimeout(READY_DELAY_MS);
  }
  throw new Error(
    "[office-g0] xlsx goto never became ready for " + SHEET_NAME + "!" + reference +
      " within " + (READY_ATTEMPTS * READY_DELAY_MS) + "ms (renderer mount/workbook readiness is a required dependency)",
  );
}

/** Reads the active selection through the renderer's control surface. */
async function readSelection(page: Page): Promise<ControlReply> {
  return await control(page, { cmd: "selection" });
}

  /**
   * Exact single-cell clipboard readback. The clipboard is CLEARED first so a stale earlier copy can never
   * satisfy the gate; the copy runs as a real Ctrl+C on the focused grid; the poll is bounded; and only the
   * exact normalized marker passes. Normalization removes a single trailing line terminator (clipboard-tsv
   * joins single cells without one; the vendor plain slice may add one) so extra clipboard content can never
   * match.
   */
  function normalizeSingleCell(text: string): string {
    return text.replace(/\r\n|\r/g, "\n").replace(/\n$/, "");
  }

  async function clipboardReadback(page: Page): Promise<{ text: string; raw: string; attempts: number }> {
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("");
    });
    const cleared = await page.evaluate(async () => navigator.clipboard.readText());
    expect(cleared, "the clipboard was cleared before the real copy").toBe("");
    await page.keyboard.press("Control+c");
    let last = "";
    for (let attempt = 1; attempt <= CLIPBOARD_POLL_ATTEMPTS; attempt += 1) {
      last = await page.evaluate(async () => navigator.clipboard.readText());
      if (normalizeSingleCell(last) === EDIT_MARKER) {
        return { text: normalizeSingleCell(last), raw: last, attempts: attempt };
      }
      await page.waitForTimeout(CLIPBOARD_POLL_DELAY_MS);
    }
    throw new Error(
      "[office-g0] the real Ctrl+C never produced the exact single-cell marker on the clipboard within " +
        CLIPBOARD_POLL_ATTEMPTS * CLIPBOARD_POLL_DELAY_MS +
        "ms; last clipboard text was " + JSON.stringify(normalizeSingleCell(last)),
    );
  }

test("xlsx: open fixture, edit Data!A1, real UI save, reopen the persisted output", async (
  { page, browser, browserName },
  testInfo,
) => {
  const fixturesDir = required("OFFICE_G0_FIXTURES_DIR", "absolute fixture directory the lab serves");
  const sourcePin = required("OFFICE_G0_SOURCE_PIN", "the immutable source pin the run was built from");
  expect(sourcePin, "the run's source pin is the pinned genoffice commit").toBe(SOURCE_PIN);
  const buildManifestSha256 = required(
    "OFFICE_G0_BUILD_MANIFEST_SHA256",
    "exact sha256 of the run's host-build-manifest.json",
  );
  expect(buildManifestSha256, "the build manifest digest is a bare sha256 hex").toMatch(SHA256_HEX);
  const projectBaseUrl = testInfo.project.use.baseURL;
  if (projectBaseUrl === undefined || projectBaseUrl === "") {
    throw new Error("[office-g0] the office-g0 project must define use.baseURL for the reopened context");
  }
  const labOrigin = new URL(projectBaseUrl).origin;

  const fixturePath = path.join(fixturesDir, FIXTURE_NAME);
  const authoredBytes = fs.readFileSync(fixturePath);
  const authoredHash = sha256(authoredBytes);
  expect(authoredHash, "authored fixture is the pinned one").toBe(FIXTURE_SHA256);

  const firstRun = observe(page);
  const evidence: {
    open: SessionOpen | null;
    reopen: SessionOpen | null;
    save: SaveReport | null;
    oracle: OracleEvidence | null;
    oracleError: string | null;
    clipboardError: string | null;
    clipboardText: string | null;
    clipboardRaw: string | null;
    clipboardAttempts: number | null;
    selection: ControlReply | null;
    preSaveSelection: ControlReply | null;
    recalcInput: ControlReply | null;
    dependentReopen: ControlReply | null;
    dependentOnScreen: unknown;
    dependentOnReopen: unknown;
  } = {
    open: null, reopen: null, save: null, oracle: null, oracleError: null, clipboardError: null,
    clipboardText: null, clipboardRaw: null, clipboardAttempts: null, selection: null, preSaveSelection: null,
    recalcInput: null, dependentReopen: null, dependentOnScreen: null, dependentOnReopen: null,
  };
  let secondRun: Diagnostics = { transportFailures: [], consoleErrors: [], pageErrors: [] };
  let reopenedContext: BrowserContext | null = null;

  try {
    // ---- 1. open: real lab session, real mount ----
    const opened = await openFixture(page, fixturePath, authoredHash);
    evidence.open = opened;
    await expect(page.locator("#univer-container.spreadsheet"), "the Univer grid mounts").toBeVisible();
    await expect(page.locator('[data-u-comp="defined-name"] input'), "A1 is the active cell on mount").toHaveValue(
      TARGET_CELL,
      { timeout: 30_000 },
    );

    // ---- 2. edit the existing A1 through real keyboard input ----
    // Activate A1, then move REAL DOM focus onto the Univer grid before typing. Programmatic activation alone
    // is not focus proof (control.ts goto() calls range.activate(); engine-render's canvas with tabIndex = 1
    // and data-u-comp='render-canvas' is the keyboard target).
    await selectCell(page, TARGET_CELL);
    await focusGrid(page);
    await expect(page.locator('[data-u-comp="defined-name"] input'), "A1 is active before typing").toHaveValue(
      TARGET_CELL,
    );
    await page.keyboard.type(EDIT_MARKER, { delay: 30 });
    await page.keyboard.press("Enter");
    // Univer normally ADVANCES the selection after Enter (A1 -> A2), so re-select A1 explicitly and prove the
    // committed value from the app's own control surface. The real keyboard edit above is untouched.
    await selectCell(page, TARGET_CELL);
    const preSaveSelection = await readSelection(page);
    evidence.preSaveSelection = preSaveSelection;
    expect(preSaveSelection.status, "pre-save selection status").toBe("ok");
    const preSaveResult = preSaveSelection.status === "ok" ? (preSaveSelection.result as SelectionResult) : null;
    const preSaveValues = Array.isArray(preSaveResult?.values) ? (preSaveResult?.values as unknown[][]) : null;
    // Prove the keyed-in edit landed on the REAL active cell BEFORE any save or reopen: the exact sheet,
    // the exact range and the exact marker value, read through the renderer's own control surface. The
    // later post-reopen preSaveSelection* gates remain as the retained evidence gate.
    expect(preSaveResult?.sheet, "the pre-save active sheet is " + SHEET_NAME).toBe(SHEET_NAME);
    expect(preSaveResult?.range, "the pre-save selection is " + TARGET_CELL).toBe(TARGET_CELL);
    expect(
      preSaveValues?.[0]?.[0],
      "the pre-save " + TARGET_CELL + " value is the edit marker",
    ).toBe(EDIT_MARKER);
    // ---- 2b. formula recalculation: edit the input Data!B3 = SUM(C1:C2) depends on ----
    // The renderer debounces then recalculates through its own control path (univer-sync
    // queueFormulaRecalc -> desktopApi.recalcWorkbook -> host:sheets-recalc -> real engine recalc).
    // No engine API is called from this test and no cell is written programmatically: the input
    // travels as real keystrokes on the focused grid exactly like the A1 edit above.
    await selectCell(page, RECALC_INPUT_CELL);
    await focusGrid(page);
    await page.keyboard.type(RECALC_INPUT_VALUE, { delay: 30 });
    await page.keyboard.press("Enter");
    await selectCell(page, RECALC_INPUT_CELL);
    const recalcInput = await readSelection(page);
    evidence.recalcInput = recalcInput;
    const recalcInputResult = recalcInput.status === "ok" ? (recalcInput.result as SelectionResult) : null;
    const recalcInputValues = Array.isArray(recalcInputResult?.values) ? (recalcInputResult?.values as unknown[][]) : null;
    expect(recalcInputResult?.sheet, "the recalc input edit is on " + SHEET_NAME).toBe(SHEET_NAME);
    expect(recalcInputResult?.range, "the recalc input selection is " + RECALC_INPUT_CELL).toBe(RECALC_INPUT_CELL);
    expect(
      recalcInputValues?.[0]?.[0],
      "the keyed " + RECALC_INPUT_CELL + " value reached the grid before any save",
    ).toBe(Number(RECALC_INPUT_VALUE));
    // The dependent cell must show the RECALCULATED value on screen before the save: this is the
    // renderer's own recalc overlay (the engine's value), not a value this test computed.
    await selectCell(page, DEPENDENT_CELL);
    let dependentOnScreen: unknown = null;
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      const reply = await readSelection(page);
      const result = reply.status === "ok" ? (reply.result as SelectionResult) : null;
      const values = Array.isArray(result?.values) ? (result.values as unknown[][]) : null;
      dependentOnScreen = values?.[0]?.[0] ?? null;
      if (String(dependentOnScreen) === DEPENDENT_VALUE) break;
      await page.waitForTimeout(READY_DELAY_MS);
    }
    evidence.dependentOnScreen = dependentOnScreen;
    expect(
      String(dependentOnScreen),
      "the dependent " + DEPENDENT_CELL + " shows the recalculated " + DEPENDENT_VALUE + " before the save",
    ).toBe(DEPENDENT_VALUE);

    const saveButton = page.locator("nav.ribbon-tabs button.qa-btn").first();
    await expect(saveButton, "the renderer's own Save control enables after a committed edit").toBeEnabled();

    // ---- 3. real UI save through the renderer's own command, then the real server response ----
    // ExcelShell.tsx: the first nav.ribbon-tabs button.qa-btn is Save (onClick={onSave}). This is
    // the app's own user command, not a host/engine call from the test.
    const saveObserved = page.waitForResponse(
      (response) => response.url().includes("/lab/host:sheets-save-edits") && response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await saveButton.click();
    const saveResponse = await saveObserved;
    expect(saveResponse.ok(), "host:sheets-save-edits HTTP status").toBe(true);
    const saveEnvelope = await saveResponse.json();
    expect(saveEnvelope.ok, "host:sheets-save-edits envelope").toBe(true);
    const saved = saveEnvelope.result as SaveReport;
    evidence.save = saved;
    expect(saved.canceled ?? false, "the save was not canceled").toBe(false);
    // The ACCEPTED central save report (lab-server.mjs host:sheets-save-edits) is
    // { ...engineResult, status:'ok', savedPath, bytes, sha256 }: a status, the server-proven published path,
    // and the byte count + sha256 the SERVER read back from that exact file. No speculative fallback path is
    // accepted, and a missing bytes/hash is a failure rather than a skipped check.
    expect(saved.status, "the save report status").toBe("ok");
    const savedReportPath = String(saved.savedPath ?? "").trim();
    if (savedReportPath.length === 0) {
      throw new Error(
        "[office-g0] the save report did not carry the accepted top-level savedPath. The lab " +
          "host:sheets-save-edits binding must return { status:'ok', savedPath, bytes, sha256 } for the " +
          "engine-published output under <lab>/out/<viewId>; the pre-save workingPath is never accepted",
      );
    }
    expect(
      Number.isInteger(saved.bytes) && (saved.bytes as number) > 0,
      "the report carries a nonempty byte count",
    ).toBe(true);
    expect(String(saved.sha256 ?? ""), "the report carries a sha256 hex").toMatch(SHA256_HEX);
    // Canonical containment: the published file resolves INSIDE the server-derived native output directory of
    // the OPENED view, <lab>/out/<opened.viewId>. <lab> is derived from the session's own workingPath shape
    // (<lab>/views/<viewId>/input/<name>), never guessed; the out root is realpath'd first and the view id is
    // joined lexically, so a junction at <out>/<viewId> cannot re-bless itself (lab-storage requireNativeOutput).
    // <lab> is derived from the session's own workingPath shape (<lab>/views/<viewId>/input/<name>), never
    // guessed: FOUR path segments up from the working-copy FILE is <lab>, three is <lab>/views.
    const labViewsRoot = path.resolve(opened.workingPath, "..", "..", ".."); // <lab>/views
    const labRoot = path.resolve(labViewsRoot, ".."); // <lab>
    expect(path.basename(labViewsRoot).toLowerCase(), "the session working copy lives under <lab>/views").toBe(
      "views",
    );
    const canonicalNativeOut = nativeOutDir(labRoot, opened.viewId);
    const publishedReal = fs.realpathSync.native(savedReportPath);
    expect(
      isInsideDir(canonicalNativeOut, publishedReal),
      "the published output is inside <lab>/out/<opened viewId> (" + canonicalNativeOut + "): " + publishedReal,
    ).toBe(true);
    expect(path.resolve(publishedReal), "the save target is not the pre-save working copy").not.toBe(
      path.resolve(opened.workingPath),
    );
    expect(isInsideDir(labViewsRoot, publishedReal), "the save target is not under views/").toBe(false);
    expect(path.resolve(publishedReal), "the authored fixture is never the save target").not.toBe(
      path.resolve(fixturePath),
    );
    expect(fs.existsSync(publishedReal), "the published output exists on disk").toBe(true);
    const savedPath = publishedReal;
    const savedBytes = fs.readFileSync(savedPath);
    expect(savedBytes.length, "the reported byte count is the bytes on disk").toBe(saved.bytes);
    expect(sha256(savedBytes), "the reported checksum is the bytes on disk").toBe(saved.sha256);
    expect(savedBytes.equals(authoredBytes), "the saved package really changed").toBe(false);
    expect(sha256(fs.readFileSync(fixturePath)), "the authored fixture is unchanged after save").toBe(authoredHash);

    // ---- 4. close the original context; reopen the saved file in a FRESH context/view ----
    await page.context().close();
    reopenedContext = await browser.newContext({
      baseURL: labOrigin,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const reopenedPage = await reopenedContext.newPage();
    secondRun = observe(reopenedPage);
    const reopened = await openFixture(reopenedPage, savedPath, sha256(savedBytes));
    evidence.reopen = reopened;
    expect(reopened.viewId, "the reopen is a distinct server-minted view").not.toBe(opened.viewId);
    // The reopenedPath handed to the oracle is the ACTUAL working copy the fresh session minted from the
    // saved file (reopened.workingPath), NOT reopened.path - which is the saved input it opened and would
    // make the oracle's fresh-reopen stability gate compare a file with itself. The canonical working copy
    // bytes must hash to the session hash the lab minted AND to the saved output hash.
    const reopenedPath = fs.realpathSync.native(reopened.workingPath);
    expect(path.resolve(reopenedPath), "the reopened path is not the saved input").not.toBe(path.resolve(savedPath));
    const reopenedWorkingBytes = fs.readFileSync(reopenedPath);
    expect(reopenedWorkingBytes.length, "the reopened working copy is nonempty").toBeGreaterThan(0);
    expect(sha256(reopenedWorkingBytes), "the reopened working copy hash equals session.hash").toBe(reopened.hash);
    expect(sha256(reopenedWorkingBytes), "the reopened working copy is the saved output").toBe(sha256(savedBytes));
    await expect(reopenedPage.locator("#univer-container.spreadsheet"), "the reopened grid mounts").toBeVisible();

    // ---- 5. the edited value is visible in the reopened workbook (separate fields) ----
    await selectCell(reopenedPage, TARGET_CELL);
    await focusGrid(reopenedPage);
    const selectionReply = await readSelection(reopenedPage);
    evidence.selection = selectionReply;
    let clipboardText: string | null = null;
    let clipboardRaw: string | null = null;
    let clipboardAttempts: number | null = null;
    try {
      const copied = await clipboardReadback(reopenedPage);
      clipboardText = copied.text;
      clipboardRaw = copied.raw;
      clipboardAttempts = copied.attempts;
    } catch (error) {
      clipboardText = null;
      evidence.clipboardError = String((error as Error)?.message ?? error);
    }

    // The recalculated dependent cell must ALSO be right after a fresh reopen: the persisted cached
    // value and the preserved formula travel with the saved bytes, not just the screen. Both the
    // edited input and the dependent formula cell are declared to the oracle, which verifies the
    // dependent ref's value AND formula from the saved package bytes.
    await selectCell(reopenedPage, DEPENDENT_CELL);
    const dependentReply = await readSelection(reopenedPage);
    evidence.dependentReopen = dependentReply;
    const dependentResult = dependentReply.status === "ok" ? (dependentReply.result as SelectionResult) : null;
    const dependentValues = Array.isArray(dependentResult?.values)
      ? (dependentResult.values as unknown[][])
      : null;
    evidence.dependentOnReopen = dependentValues?.[0]?.[0] ?? null;
    expect(dependentResult?.sheet, "the reopened dependent read is on " + SHEET_NAME).toBe(SHEET_NAME);
    expect(dependentResult?.range, "the reopened dependent read is " + DEPENDENT_CELL).toBe(DEPENDENT_CELL);
    expect(
      String(evidence.dependentOnReopen),
      "the reopened " + DEPENDENT_CELL + " shows the recalculated " + DEPENDENT_VALUE,
    ).toBe(DEPENDENT_VALUE);

    // ---- 6. the independent persisted-file oracle (owner: oracle worker) ----
    try {
      evidence.oracle = (await verifyXlsxOutput({
        fixturePath,
        savedPath,
        reopenedPath, // the fresh session's working copy, never the saved input (defect 1)
        expectedMarker: EDIT_MARKER,
        target: { sheetName: SHEET_NAME, cell: TARGET_CELL },
        // The save legitimately changed TWO cells: the edited input and the dependent formula cell
        // the engine recalculated. Declaring both keeps the non-target preservation gate strict
        // (every other authored cell/part still has to survive byte-for-byte) while the dependent
        // cell is verified by the value AND formula it must carry.
        editedRefs: [TARGET_CELL, RECALC_INPUT_CELL, DEPENDENT_CELL],
        editExpectations: {
          [RECALC_INPUT_CELL]: { value: RECALC_INPUT_VALUE },
          [DEPENDENT_CELL]: { value: DEPENDENT_VALUE, formula: DEPENDENT_FORMULA },
        },
      })) as OracleEvidence;
    } catch (error) {
      evidence.oracle = null;
      evidence.oracleError = String((error as Error)?.message ?? error);
    }

    const savedBytesAfterReopen = fs.readFileSync(savedPath);
    const selectionResult =
      selectionReply.status === "ok" ? (selectionReply.result as SelectionResult) : null;
    const selectionValues = Array.isArray(selectionResult?.values) ? (selectionResult?.values as unknown[][]) : null;
    // The reopened screenshot is the last awaited UI operation of this run. Take it BEFORE the final
    // snapshot so any console/page/request error it triggers lands in the arrays below (and in the
    // diagnosticsClear gate). The firstRun and secondRun collectors stay LIVE throughout: nothing here
    // freezes them, and the failure path still copies them again for xlsx-failure-evidence.json.
    await testInfo.attach("xlsx-reopen.png", {
      body: await reopenedPage.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    // Final snapshot AFTER the screenshot: the merged arrays are re-read from the retained live
    // collectors now, never captured before an awaited UI operation. A stale array can no longer
    // report diagnosticsClear true.
    const diagnostics: Diagnostics = {
      transportFailures: [...firstRun.transportFailures, ...secondRun.transportFailures],
      consoleErrors: [...firstRun.consoleErrors, ...secondRun.consoleErrors],
      pageErrors: [...firstRun.pageErrors, ...secondRun.pageErrors],
    };
    const gates = {
      sourcePinIsPinned: sourcePin === SOURCE_PIN,
      manifestShaIsHex: SHA256_HEX.test(buildManifestSha256),
      authoredFixtureUnchanged: sha256(fs.readFileSync(fixturePath)) === authoredHash,
      saveStatusOk: saved.status === "ok",
      savedPathReported: savedReportPath.length > 0,
      savedBytesReported: Number.isInteger(saved.bytes) && (saved.bytes as number) > 0,
      savedShaReported: SHA256_HEX.test(String(saved.sha256 ?? "")),
      savedBytesMatchReport: savedBytes.length === saved.bytes,
      savedShaMatchesReport: sha256(savedBytes) === saved.sha256,
      savedContainedInNativeOut: isInsideDir(canonicalNativeOut, publishedReal),
      savedNotPreSaveWorkingCopy: path.resolve(publishedReal) !== path.resolve(opened.workingPath),
      savedNotUnderViews: !isInsideDir(labViewsRoot, publishedReal),
      savedBytesChanged: !savedBytes.equals(authoredBytes),
      savedOutputStableAfterReopen: sha256(savedBytesAfterReopen) === sha256(savedBytes),
      reopenedWorkingCopyIsViewsWorkingCopy:
        isInsideDir(path.join(labViewsRoot, reopened.viewId, "input"), reopenedPath),
      reopenedWorkingCopyHashIsSessionHash: sha256(reopenedWorkingBytes) === reopened.hash,
      reopenedWorkingCopyHashIsSavedHash: sha256(reopenedWorkingBytes) === sha256(savedBytes),
      distinctReopenView: reopened.viewId !== opened.viewId,
      preSaveSelectionStatusOk: preSaveSelection.status === "ok",
      preSaveSelectionSheetIsData: preSaveResult?.sheet === SHEET_NAME,
      preSaveSelectionRangeIsTarget: preSaveResult?.range === TARGET_CELL,
      preSaveSelectionValueIsMarker: preSaveValues?.[0]?.[0] === EDIT_MARKER,
      selectionStatusOk: selectionReply.status === "ok",
      selectionSheetIsData: selectionResult?.sheet === SHEET_NAME,
      selectionRangeIsTarget: selectionResult?.range === TARGET_CELL,
      selectionValueIsMarker: selectionValues?.[0]?.[0] === EDIT_MARKER,
      clipboardExactSingleCellMarker: clipboardText === EDIT_MARKER,
      // formula recalculation: the keyed input, the recalculated dependent value on screen and in
      // the reopened view, and the oracle's own declared-expectation gate over the saved bytes.
      recalcInputStatusOk: recalcInput.status === "ok",
      recalcInputRangeIsTarget: recalcInputResult?.range === RECALC_INPUT_CELL,
      recalcInputValueIsEdited: recalcInputValues?.[0]?.[0] === Number(RECALC_INPUT_VALUE),
      dependentRecalculatedOnScreen: String(evidence.dependentOnScreen) === DEPENDENT_VALUE,
      dependentRecalculatedAfterReopen: String(evidence.dependentOnReopen) === DEPENDENT_VALUE,
      oracleEditExpectationsMet: Boolean(
        (evidence.oracle as { edits?: { met?: boolean } } | null)?.edits?.met,
      ),
      oracleRan: evidence.oracleError === null && evidence.oracle !== null,
      oracleOk: evidence.oracle?.ok === true,
      oraclePinsFixture: evidence.oracle?.fixtureSha256 === authoredHash,
      oraclePinsSaved: evidence.oracle?.savedSha256 === sha256(savedBytes),
      oraclePinsReopened: evidence.oracle?.reopenedSha256 === sha256(reopenedWorkingBytes),
      diagnosticsClear:
        diagnostics.transportFailures.length === 0 &&
        diagnostics.consoleErrors.length === 0 &&
        diagnostics.pageErrors.length === 0,
    };
    const passed = Object.values(gates).every((value) => value === true);

    await testInfo.attach("xlsx-cycle-evidence.json", {
      body: JSON.stringify(
        {
          claim: passed
            ? "browser-real xlsx open/edit/save/close/reopen passed every listed gate on this run"
            : "run did not pass every listed gate; see gates, oracleError, clipboardError and diagnostics",
          runtime: {
            node: process.version,
            browser: { name: browserName, version: browser.version() },
            os: { platform: process.platform, release: os.release(), arch: process.arch },
            labOrigin,
          },
          sourcePin,
          buildManifestSha256,
          fixture: {
            path: fixturePath,
            bytes: authoredBytes.length,
            sha256: authoredHash,
            sha256AfterReopen: sha256(fs.readFileSync(fixturePath)),
          },
          output: {
            path: savedPath,
            reportedPath: savedReportPath,
            nativeOutDir: canonicalNativeOut,
            bytes: savedBytes.length,
            sha256: sha256(savedBytes),
            reportedBytes: saved.bytes,
            reportedSha256: saved.sha256,
            distinctFromAuthored: gates.savedBytesChanged,
            sha256AfterReopen: sha256(savedBytesAfterReopen),
            stableAfterReopen: gates.savedOutputStableAfterReopen,
          },
          saveResponse: saved,
          sessions: { initial: opened, reopened },
          reopened: {
            viewId: reopened.viewId,
            inputPath: reopened.path,
            workingPath: reopenedPath,
            workingPathSha256: sha256(reopenedWorkingBytes),
            sessionHash: reopened.hash,
            preSaveSelection,
            selection: selectionReply,
            clipboardText,
            clipboardRaw,
            clipboardAttempts,
            clipboardError: evidence.clipboardError,
          },
          oracle: { evidence: evidence.oracle, error: evidence.oracleError },
          uiOperations:
            "GET /sheets/?fixture=<authored path>; observed lab:session-open/hash/viewId; asserted the mounted " +
            "#univer-container grid and the A1 name box; activated A1 via the renderer control surface (goto, " +
            "bounded not_ready retry); moved real DOM focus onto [data-u-comp='render-canvas']; typed the marker " +
            "with real key events; Enter; re-selected A1 explicitly (Univer advances after Enter) and read the " +
            "pre-save Data/A1 marker from the app's own control surface; asserted the renderer's own Save control " +
            "enabled; clicked the Save command; observed POST /lab/host:sheets-save-edits; required the accepted " +
            "{status, savedPath, bytes, sha256} report, its containment under <lab>/out/<opened viewId>, and its " +
            "bytes/hash against disk; closed the context; opened the published path in a fresh context; asserted a " +
            "distinct viewId and that the fresh session working copy hashes to session.hash and the saved hash; " +
            "re-selected A1, read the selection fields, and took an exact cleared-clipboard Ctrl+C readback; called " +
            "verifyXlsxOutput with the reopened working copy and required its own ok gate",
          gates,
          diagnostics,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });

    // Every required gate fails explicitly when unmet; nothing here is softened or skipped.
    expect(gates.sourcePinIsPinned, "OFFICE_G0_SOURCE_PIN is the pinned genoffice commit").toBe(true);
    expect(gates.manifestShaIsHex, "the run's build manifest digest is a bare sha256 hex").toBe(true);
    expect(gates.authoredFixtureUnchanged, "the authored fixture survives the cycle").toBe(true);
    // save report: accepted central shape, reported bytes/hash, and canonical containment.
    expect(gates.saveStatusOk, "the save report status is ok").toBe(true);
    expect(gates.savedPathReported, "the save report names the published output").toBe(true);
    expect(gates.savedBytesReported, "the save report carries a nonempty byte count").toBe(true);
    expect(gates.savedShaReported, "the save report carries a sha256 hex").toBe(true);
    expect(gates.savedBytesMatchReport, "the reported byte count is the bytes on disk").toBe(true);
    expect(gates.savedShaMatchesReport, "the reported checksum is the bytes on disk").toBe(true);
    expect(
      gates.savedContainedInNativeOut,
      "the published output is inside <lab>/out/<opened viewId>" +
        (evidence.save ? " (" + String(evidence.save.savedPath ?? "") + ")" : ""),
    ).toBe(true);
    expect(gates.savedNotPreSaveWorkingCopy, "the save target is not the pre-save working copy").toBe(true);
    expect(gates.savedNotUnderViews, "the save target is not under views/").toBe(true);
    expect(gates.savedBytesChanged, "the saved bytes differ from the authored fixture").toBe(true);
    expect(gates.savedOutputStableAfterReopen, "the persisted output is stable across the reopen").toBe(true);
    // reopen identity: the oracle sees the real reopened working copy, hashed two ways.
    expect(gates.distinctReopenView, "reopen viewId differs from the open viewId").toBe(true);
    expect(
      gates.reopenedWorkingCopyIsViewsWorkingCopy,
      "the reopened path is the fresh session's working copy under <lab>/views/<viewId>/input",
    ).toBe(true);
    expect(gates.reopenedWorkingCopyHashIsSessionHash, "the reopened working copy hash equals session.hash").toBe(
      true,
    );
    expect(gates.reopenedWorkingCopyHashIsSavedHash, "the reopened working copy is the saved output").toBe(true);
    // pre-save committed edit proof (post-Enter reselect).
    expect(gates.preSaveSelectionStatusOk, "the pre-save selection control answered").toBe(true);
    expect(gates.preSaveSelectionSheetIsData, "the pre-save active sheet is " + SHEET_NAME).toBe(true);
    expect(gates.preSaveSelectionRangeIsTarget, "the pre-save selection is " + TARGET_CELL).toBe(true);
    expect(gates.preSaveSelectionValueIsMarker, "the pre-save " + TARGET_CELL + " value is the edit marker").toBe(
      true,
    );
    // reopened visibility.
    expect(gates.selectionStatusOk, "the reopened workbook answers its selection control").toBe(true);
    expect(gates.selectionSheetIsData, "the reopened active sheet is " + SHEET_NAME).toBe(true);
    expect(gates.selectionRangeIsTarget, "the reopened selection is " + TARGET_CELL).toBe(true);
    expect(gates.selectionValueIsMarker, "the reopened " + TARGET_CELL + " value is the edit marker").toBe(true);
    expect(
      gates.clipboardExactSingleCellMarker,
      "the cleared-clipboard Ctrl+C readback is exactly the single-cell marker" +
        (evidence.clipboardError ? " (" + evidence.clipboardError + ")" : ""),
    ).toBe(true);
    // formula recalculation, proven on screen, after a fresh reopen, and in the saved bytes.
    expect(gates.recalcInputStatusOk, "the " + RECALC_INPUT_CELL + " input edit answered its control").toBe(true);
    expect(gates.recalcInputRangeIsTarget, "the " + RECALC_INPUT_CELL + " selection is the edited input").toBe(
      true,
    );
    expect(gates.recalcInputValueIsEdited, "the keyed " + RECALC_INPUT_CELL + " value is the edit").toBe(true);
    expect(
      gates.dependentRecalculatedOnScreen,
      "the engine recalculated " + DEPENDENT_CELL + " to " + DEPENDENT_VALUE + " before the save" +
        " (saw " + JSON.stringify(evidence.dependentOnScreen) + ")",
    ).toBe(true);
    expect(
      gates.dependentRecalculatedAfterReopen,
      "the persisted output still recalcs " + DEPENDENT_CELL + " to " + DEPENDENT_VALUE + " after a fresh reopen" +
        " (saw " + JSON.stringify(evidence.dependentOnReopen) + ")",
    ).toBe(true);
    expect(
      gates.oracleEditExpectationsMet,
      "the oracle verified the declared " + DEPENDENT_CELL + " value+formula in the saved package",
    ).toBe(true);
    expect(
      gates.oracleRan,
      "the independent xlsx output oracle ran without throwing" +
        (evidence.oracleError ? " (" + evidence.oracleError + ")" : ""),
    ).toBe(true);
    expect(gates.oracleOk, "the oracle's own ok gate is true (every oracle gate met)").toBe(true);
    expect(gates.oraclePinsFixture, "the oracle pins the authored fixture sha256").toBe(true);
    expect(gates.oraclePinsSaved, "the oracle pins the saved output sha256").toBe(true);
    expect(gates.oraclePinsReopened, "the oracle pins the reopened working-copy sha256").toBe(true);
    expect(diagnostics.transportFailures, "lab transport failures").toEqual([]);
    expect(diagnostics.pageErrors, "page errors").toEqual([]);
    expect(diagnostics.consoleErrors, "console errors").toEqual([]);
  } catch (error) {
    // Failure artifacts are retained so an aborted gate is legible evidence, never a bare timeout.
    const diagnostics: Diagnostics = {
      transportFailures: [...firstRun.transportFailures, ...secondRun.transportFailures],
      consoleErrors: [...firstRun.consoleErrors, ...secondRun.consoleErrors],
      pageErrors: [...firstRun.pageErrors, ...secondRun.pageErrors],
    };
    try {
      await testInfo.attach("xlsx-failure-evidence.json", {
        body: JSON.stringify(
          {
            reason: String((error as Error)?.message ?? error),
            sessions: evidence,
            sourcePin,
            buildManifestSha256,
            fixturePath,
            diagnostics,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } catch {
      /* the original failure is rethrown below; an artifact failure must not mask it */
    }
    try {
      const shotPage = reopenedContext ? reopenedContext.pages()[0] : page;
      if (shotPage) {
        await testInfo.attach("xlsx-failure.png", {
          body: await shotPage.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      }
    } catch {
      /* best effort only */
    }
    throw error;
  } finally {
    if (reopenedContext) await reopenedContext.close().catch(() => undefined);
  }
});

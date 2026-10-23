// UNI-667 office-g0 PPTX reality cycle. Opens the immutable g0-slides.pptx through the
// real /slides/ page bootstrap, enters text editing on slide 1's existing Text1 box by
// double-clicking its real glyph area, replaces its text through the renderer's own
// contentEditable overlay, commits with the overlay's own Escape/commit path, saves by
// clicking the renderer's own Quick-Access Save button (Ribbon.tsx:1784-1790), observes
// the real POST /lab/host:slides-save, closes that browser context, reopens the persisted
// file in a fresh context, and asserts the edited content in the reopened UI plus the
// independent persisted-output oracle.
//
// No engine/save API is called directly by this test, no page global is assigned, no
// session is minted, no transport is faked, and nothing softens a missing gate. The lab
// server mints the view id; the renderer performs the edit and the save.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const FIXTURE_NAME = "g0-slides.pptx";
const FIXTURE_SHA256 = "4f85bdd59277a70bc94a66ebd39dd4882f88b5edd4211c0d3de6d09b6763d935";
const SOURCE_PIN = "09485f884dc845cf3bf27fb7edfe489f9d457aad";
// parallel-wave2 target identity (persisted, not a runtime shape id).
const TARGET = { slidePart: "ppt/slides/slide1.xml", elementKind: "p:sp", cNvPrId: "3" };
// The authored text of that element, used to prove the overlay opened on Text1.
// F1: the authored target ALREADY contains "edited-by-lab", so the save marker must be
// DISTINCT from it and unique per run; passing the authored default would let a
// metadata-only save false-pass. A fixed prefix plus a run-nonce, chosen so it cannot
// exist in the authored fixture.
const AUTHORED_TEXT = "edited-by-lab";
const MARKER_PREFIX = "UNI-667-PPTX";
const EDIT_MARKER = MARKER_PREFIX + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
const PRESERVED_TITLE = "DOC-003 slide title";
const PRESERVED_SECOND = "Second slide";
// Authored geometry of the target text box, from the pinned fixture builder
// (0.5in, 1.4in, 18pt) at the deck's 96px/in base scaled to FIT_WIDTH=1280 (4/3).
const TARGET_BOX_SLIDE_PX = { x: 64, y: 179.2, w: 512, h: 76.8 };
const TEXT_ENTRY_OFFSET = { x: 18, y: 20.4 }; // inside the first laid-out line's glyphs

type Diagnostics = { transportFailures: string[]; consoleErrors: string[]; pageErrors: string[] };
type SessionOpen = {
  viewId: string; app: string; path: string; name: string; hash: string;
  size: number; workingPath: string;
};
type SelectionReply = {
  status: "ok" | "not_ready" | "error";
  result?: { slide: number; elements: string[]; types: string[] };
};
type SaveResult = {
  ok?: boolean; path?: string; savedPath?: string; bytes?: number; sha256?: string;
  dirty?: boolean; slides?: unknown[] | null; count?: number | null;
};
// The APPLIED host:slides-edit-text channel (lab-server:1002) unwraps the engine envelope
// and answers the committed RenderSlide (result.slide). beforeText/afterText/applied are
// NOT on that surface any more, so r1's EditResult type (and every assertion that read
// edited.beforeText/afterText) was verifying a shape the channel no longer returns.
type RenderTextRunReply = { text?: string };
type RenderTextLineReply = { runs?: RenderTextRunReply[] };
type RenderNodeReply = {
  type?: string;
  text?: { lines?: RenderTextLineReply[] };
  children?: RenderNodeReply[];
};
type RenderSlideReply = { nodes?: RenderNodeReply[] };
// The accepted oracle returns a richer schema than r1 declared and it THROWS on any failed
// gate, so a RETURNED object is always ok:true and always carries the bound paths plus
// reopenedStable. r1's type omitted all of that.
type OracleEvidence = {
  oracle: string; version: number; ok: true;
  fixturePath: string; savedPath: string; reopenedPath: string;
  fixtureSha256: string; savedSha256: string; reopenedSha256: string;
  savedDiffersFromFixture: boolean; reopenedStable: boolean;
  identity?: { identityString?: string; matchCount?: number; ambiguous?: boolean };
  target?: { found?: boolean; identity?: string | null; text?: string | null; markerPresent?: boolean };
  gates?: Record<string, boolean | null>;
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A required value; missing or malformed input is a named failure, never a skip. */
function requireEnv(name: string, pattern: RegExp, hint: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new Error("[office-g0] " + name + " is required: " + hint);
  if (!pattern.test(value)) throw new Error("[office-g0] " + name + " is malformed: " + value);
  return value;
}

const emptyDiagnostics = (): Diagnostics => ({ transportFailures: [], consoleErrors: [], pageErrors: [] });

// The render tree one committed slide carries, in tree order (groups walked). The applied
// host:slides-edit-text channel answers a RenderSlide, so this is how the edited content is
// read back from the very tree the renderer now holds.
// (RenderTextRunReply / RenderTextLineReply / RenderNodeReply / RenderSlideReply are declared
// once, in the H2 response-type block above.)
function renderTextOf(slide: RenderSlideReply | null | undefined): string {
  const parts: string[] = [];
  const walk = (nodes: RenderNodeReply[] | undefined) => {
    for (const node of nodes ?? []) {
      for (const line of node.text?.lines ?? []) {
        for (const run of line.runs ?? []) if (typeof run.text === "string") parts.push(run.text);
      }
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(slide?.nodes);
  return parts.join(" ");
}

// Defect 3 fix: the listeners push into ONE live sink. r1 merged snapshots at reopen start,
// so a second-context error pushed after that moment never reached the final gate. Every
// report and assertion now reads snapshotDiagnostics(sink) only after all UI operations.
function observe(page: Page, sink: Diagnostics): Diagnostics {
  page.on("response", (response) => {
    if (response.status() >= 400) {
      sink.transportFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    sink.transportFailures.push(`REQUEST_FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") sink.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => sink.pageErrors.push(String(error.message ?? error)));
  return sink;
}

/** A point-in-time copy of the live collectors; only for the report and the final gates. */
const snapshotDiagnostics = (sink: Diagnostics): Diagnostics => ({
  transportFailures: [...sink.transportFailures],
  consoleErrors: [...sink.consoleErrors],
  pageErrors: [...sink.pageErrors],
});

// Defect 1 fix: containment is REALPATH based AND RELATIVE based (path.relative), so a junction
// that resolves out of the directory is caught and a shared lexical prefix (…/out vs …/out2)
// can never be mistaken for a child.
function realpathOf(target: string): string {
  return fs.realpathSync(target);
}
function isInsideReal(root: string, target: string): boolean {
  const resolvedRoot = realpathOf(root);
  const resolvedTarget = realpathOf(target);
  if (resolvedTarget === resolvedRoot) return true;
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// The lab root and view directory of the CURRENT server-minted session, derived STRUCTURALLY
// from the session the server reported - never from a loose parent assembled out of an
// arbitrary supplied path. The accepted central lab-storage.mjs (24070 B) creates the working
// copy at exactly <lab>/views/<viewId>/input/<name> (ViewSessions.open, :327-333) and
// requireNativeOutput (:582-599) proves a publication against <lab>/out/<viewId>, so this
// derivation is CHECKED against that shape and throws rather than trusting blind ".." hops.
function viewDirOf(opened: SessionOpen): { labRoot: string; viewDir: string } {
  const workingDir = path.dirname(path.resolve(opened.workingPath));
  const viewDir = path.dirname(workingDir);
  const viewsRoot = path.dirname(viewDir);
  const labRoot = path.dirname(viewsRoot);
  if (path.basename(workingDir) !== "input") {
    throw new Error(
      "[office-g0] the session working copy is not <lab>/views/<viewId>/input/<name>: " + opened.workingPath,
    );
  }
  if (path.basename(viewsRoot) !== "views") {
    throw new Error("[office-g0] the session view is not under a lab 'views' root: " + opened.workingPath);
  }
  // The view directory must be the id the SERVER minted for this session, not a caller segment.
  if (path.basename(viewDir) !== opened.viewId) {
    throw new Error(
      "[office-g0] the session working copy lives in view '" + path.basename(viewDir) +
        "', not the server-minted '" + opened.viewId + "'",
    );
  }
  return { labRoot, viewDir };
}
/** The one canonical native output directory of this view: <lab>/out/<viewId>. */
function canonicalOutputDir(opened: SessionOpen): string {
  return path.join(viewDirOf(opened).labRoot, "out", opened.viewId);
}

/** Open one lab page and return the server-minted session; never invents a view id. */
async function openFixture(page: Page, fixturePath: string, expectedHash: string): Promise<SessionOpen> {
  const sessionOpened = page.waitForResponse(
    (response) => response.url().includes("/lab/lab:session-open") && response.request().method() === "POST",
  );
  await page.goto("/slides/?fixture=" + encodeURIComponent(fixturePath));
  const response = await sessionOpened;
  expect(response.ok(), "lab:session-open HTTP status").toBe(true);
  const envelope = await response.json();
  expect(envelope.ok, "lab:session-open envelope").toBe(true);
  const session = envelope.result as SessionOpen;
  expect(session.app, "session app").toBe("slides");
  expect(session.path, "session fixture path").toBe(fixturePath);
  expect(session.hash, "session source hash is the file on disk").toBe(expectedHash);
  expect(session.viewId).toMatch(/^view-/);
  expect(session.workingPath, "session working copy").toBeTruthy();
  await expect(page.locator("body")).not.toContainText("lab host bootstrap failed");
  return session;
}

/** Wait until the real slides renderer has mounted its stage and canvas. */
async function waitForEditor(page: Page): Promise<void> {
  const stage = page.locator(".stage-rel");
  await expect(stage).toBeVisible();
  await expect(page.locator(".stage-rel canvas").first()).toBeVisible();
  await page.evaluate(async () => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) await fonts.ready;
  });
}

/** The renderer's own control surface (App.tsx:2913); read-only, never assigned here. */
async function selection(page: Page): Promise<SelectionReply | null> {
  return page.evaluate(async () => {
    const control = (window as unknown as Record<string, unknown>).__genofficeControl;
    if (typeof control !== "function") return null;
    return (await (control as (req: unknown) => Promise<unknown>)({ cmd: "selection" })) as
      | { status: "ok" | "not_ready" | "error"; result?: { slide: number; elements: string[]; types: string[] } }
      | null;
  });
}

/**
 * Enter real text editing on the existing slide-1 Text1 box by double-clicking its
 * authored glyph area, then replace the whole text through the overlay's own
 * contentEditable (Ctrl+A is native here: the global handler returns early while focus
 * is in a contentEditable) and commit with Escape (TextEditOverlay.tsx:854-860).
 */
async function editText1(page: Page): Promise<RenderSlideReply> {
  const stage = page.locator(".stage-rel");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[office-g0] the slide stage has no measurable box");
  // Zoom comes from the real CSS transform on .stage-scale; derive it from the stage box.
  const scale = box.width / 1280;
  const clientX = box.x + (TARGET_BOX_SLIDE_PX.x + TEXT_ENTRY_OFFSET.x) * scale;
  const clientY = box.y + (TARGET_BOX_SLIDE_PX.y + TEXT_ENTRY_OFFSET.y) * scale;
  await page.mouse.dblclick(clientX, clientY);
  const editor = page.locator(".slide-text-editor");
  await expect(editor, "the text-edit overlay opens on the double-clicked text box").toBeVisible();
  // Identity in the UI: the overlay must carry the authored text of Text1, not another box.
  await expect(editor, "the overlay opened on the authored Text1 content").toContainText(AUTHORED_TEXT);
  // F1 negative guard: the run marker must not already be present before we type it.
  await expect(editor, "the per-run marker cannot pre-exist in the authored text").not.toContainText(MARKER_PREFIX);
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete"); // Ctrl+A then Delete: a real replacement, not an append
  await expect(editor, "Ctrl+A + Delete really cleared the authored text").not.toContainText(AUTHORED_TEXT);
  await page.keyboard.type(EDIT_MARKER, { delay: 20 });
  await expect(editor, "the typed marker is in the live editor before commit").toContainText(EDIT_MARKER);
  const editObserved = page.waitForResponse(
    (response) => response.url().includes("/lab/host:slides-edit-text") && response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.keyboard.press("Escape"); // overlay commit path, not a host call from this test
  const editResponse = await editObserved;
  expect(editResponse.ok(), "host:slides-edit-text HTTP status (strict, never softened)").toBe(true);
  const editEnvelope = await editResponse.json();
  expect(editEnvelope.ok, "host:slides-edit-text envelope").toBe(true);
  // The applied channel returns the committed RenderSlide (lab-server host:slides-edit-text
  // -> result.slide). Assert the exact shape, never the removed envelope fields.
  const committed = editEnvelope.result as RenderSlideReply;
  expect(Array.isArray(committed?.nodes), "the channel answers a RenderSlide with a node array").toBe(true);
  // F1 no-op protection, read from the tree the renderer now holds: the marker must be in the
  // committed content AND the authored text must be gone, so an unreplaced/no-op edit cannot pass.
  const committedText = renderTextOf(committed);
  expect(committedText, "the committed render tree carries the per-run marker").toContain(EDIT_MARKER);
  expect(committedText, "the authored text was really replaced, not appended").not.toContain(AUTHORED_TEXT);
  await expect(editor).toHaveCount(0);
  return committed;
}

/** Switch the real ribbon to the View tab and then to Outline View (DOM text of the deck). */
async function enterOutlineView(page: Page): Promise<void> {
  await page.locator(".ribbon-tabs button.ribbon-tab").filter({ hasText: /^View$/ }).first().click();
  await page.locator(".rb-big").filter({ hasText: "Outline View" }).first().click();
  await expect(page.locator(".outline-pane")).toBeVisible();
}

test("pptx: open fixture, edit slide1 Text1, save, close, reopen the persisted deck", async (
  { page, browser, browserName },
  testInfo,
) => {
  const fixturesDir = requireEnv("OFFICE_G0_FIXTURES_DIR", /./, "absolute fixture directory the lab serves");
  const sourcePin = requireEnv("OFFICE_G0_SOURCE_PIN", /^[0-9a-f]{40}$/, "the pinned source commit");
  const manifestSha = requireEnv("OFFICE_G0_BUILD_MANIFEST_SHA256", /^[0-9a-f]{64}$/, "the approved build manifest digest");
  expect(sourcePin, "the run is pinned to the frozen source commit").toBe(SOURCE_PIN);

  const fixturePath = path.join(fixturesDir, FIXTURE_NAME);
  const authoredBytes = fs.readFileSync(fixturePath);
  const authoredHash = sha256(authoredBytes);
  expect(authoredHash, "authored fixture is the pinned one").toBe(FIXTURE_SHA256);
  // F1: the chosen marker is proven absent from the authored bytes and from the authored
  // text of the target, so a metadata-only save (or a re-save of unchanged content) can
  // never satisfy the marker gates.
  expect(authoredBytes.includes(MARKER_PREFIX), "the per-run marker prefix is absent from the authored fixture").toBe(false);
  expect(AUTHORED_TEXT.includes(MARKER_PREFIX), "the marker is distinct from the authored target text").toBe(false);

  // Defect 3: ONE live sink collects both contexts from the very first listener onward; the
  // report and the final gates read snapshotDiagnostics(diagnostics) after all UI work.
  const diagnostics = emptyDiagnostics();
  observe(page, diagnostics);
  let savedPath: string | null = null;
  let reopenedPage: Page | null = null;
  // Defect 4: declared out here so the catch can always close it, even when newPage or
  // openFixture throws.
  let reopenedContext: BrowserContext | null = null;
  try {
    const opened = await openFixture(page, fixturePath, authoredHash);
    await waitForEditor(page);

    // ONE real edit; the channel returns the committed RenderSlide, whose text carries the
    // per-run marker and no longer the authored text (asserted inside editText1). Calling
    // editText1 twice would perform two edits and defeat the marker/no-op guard.
    const committed = await editText1(page);
    expect(renderTextOf(committed), "the committed tree carries the marker once").toContain(EDIT_MARKER);
    await expect(page.locator("button.qa-btn[aria-label*='Save']")).toBeEnabled(); // App.tsx setDirty(true) after commit

    const saveObserved = page.waitForResponse(
      (response) => response.url().includes("/lab/host:slides-save") && response.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.locator("button.qa-btn[aria-label*='Save']").click();
    const saveResponse = await saveObserved;
    expect(saveResponse.ok(), "host:slides-save HTTP status").toBe(true);
    const saveEnvelope = await saveResponse.json();
    expect(saveEnvelope.ok, "host:slides-save envelope").toBe(true);
    const saved = saveEnvelope.result as SaveResult;
    expect(typeof saved.savedPath === "string" && saved.savedPath.length > 0, "save reports a real path").toBe(true);
    expect(saved.path, "the publication path is the reported savedPath").toBe(saved.savedPath);
    expect(saved.ok, "the save result is ok").toBe(true);
    expect(saved.bytes ?? 0, "save reports non-empty bytes").toBeGreaterThan(0);
    expect(typeof saved.sha256 === "string" && /^[0-9a-f]{64}$/.test(saved.sha256), "save reports a sha256").toBe(true);

    savedPath = fs.realpathSync(saved.savedPath as string);
    const nativeOutDir = canonicalOutputDir(opened);
    // Defect 1: a native save publishes under the CURRENT view's canonical output directory
    // <lab>/out/<viewId>; it is never the pre-save working copy, never views/<id>/out, never
    // the authored fixture, and never a loose parent derived from a supplied path.
    // realpath both sides: the lane itself may sit under a junction, and the assertion is
    // about the canonical DIRECTORY being <lab>/out/<viewId>, not about a lexical prefix.
    expect(path.dirname(savedPath), "the publication's real directory is <lab>/out/<viewId>").toBe(
      realpathOf(nativeOutDir),
    );
    expect(isInsideReal(nativeOutDir, savedPath), "realpath containment in <lab>/out/<viewId>").toBe(true);
    expect(savedPath, "the publication is distinct from the pre-save working copy").not.toBe(
      realpathOf(opened.workingPath),
    );
    expect(savedPath, "the authored fixture is never the save target").not.toBe(realpathOf(fixturePath));
    expect(isInsideReal(nativeOutDir, savedPath), "saved file stays in its view output grant").toBe(true);
    const savedBytes = fs.readFileSync(savedPath);
    expect(savedBytes.length).toBe(saved.bytes);
    expect(sha256(savedBytes), "the reported checksum is the bytes on disk").toBe(saved.sha256);
    expect(savedBytes.equals(authoredBytes), "the saved package really changed").toBe(false);
    expect(sha256(fs.readFileSync(fixturePath)), "authored fixture unchanged after save").toBe(authoredHash);
    // The pre-save working copy is untouched by the publication (the save wrote elsewhere).
    expect(fs.readFileSync(opened.workingPath).equals(authoredBytes), "the pre-save working copy is unmodified").toBe(true);

    await page.context().close(); // the original browser context is gone before the reopen
    const configuredBase = testInfo.project.use.baseURL;
    if (!configuredBase) throw new Error("[office-g0] the project must provide use.baseURL for the reopened context");
    // Defect 4: the context is created into an outer binding; the catch below always closes
    // it, including when newPage() or openFixture() throws, and never masks the original
    // error with a cleanup failure.
    reopenedContext = await browser.newContext({
      baseURL: new URL(configuredBase).origin,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });
    reopenedPage = await reopenedContext.newPage();
    // Defect 3: the same live sink keeps collecting from this page; nothing is snapshotted
    // here, so a second-context error pushed after this line still reaches the final gates.
    observe(reopenedPage, diagnostics);
    {
      const reopened = await openFixture(reopenedPage, savedPath, sha256(savedBytes));
      expect(reopened.viewId, "the reopen is a NEW server-minted view").not.toBe(opened.viewId);
      expect(reopened.path, "the reopened session consumed the published file").toBe(savedPath);
      await waitForEditor(reopenedPage);

      // The reopened session holds a fresh working COPY of the published file. Defect 2: the
      // oracle must read the reopened view's OWN working copy, not the saved input again.
      expect(reopened.workingPath, "the reopened view has its own working copy").not.toBe(savedPath);
      expect(reopened.hash, "the reopened session hash is the saved bytes on disk").toBe(sha256(savedBytes));
      const reopenedWorking = realpathOf(reopened.workingPath);
      expect(isInsideReal(path.join(viewDirOf(reopened).viewDir, "input"), reopenedWorking),
        "the reopened working copy is inside the reopened view's own directory").toBe(true);
      const reopenedWorkingBytes = fs.readFileSync(reopenedWorking);
      expect(reopenedWorkingBytes.length, "the reopened working copy has the saved byte length").toBe(savedBytes.length);
      expect(sha256(reopenedWorkingBytes), "the reopened working copy bytes equal the saved bytes").toBe(sha256(savedBytes));

      // Visible edited content in the reopened UI: the renderer's own Outline View renders
      // the reopened render tree's text into real DOM (App.tsx:3427 outline-pane/outlineOf).
      await enterOutlineView(reopenedPage);
      const pane = reopenedPage.locator(".outline-pane");
      await expect(pane).toContainText(EDIT_MARKER);
      await expect(pane).toContainText(PRESERVED_TITLE);
      await expect(pane).toContainText(PRESERVED_SECOND);
      const reply = await selection(reopenedPage);
      expect(reply, "the reopened renderer exposes its own control surface").not.toBeNull();
      await reopenedPage.screenshot({ fullPage: true }).then((body) =>
        testInfo.attach("pptx-reopen.png", { body, contentType: "image/png" }),
      );

      // Independent persisted-output oracle (oracle lane). It reads the real bytes, enforces
      // the pinned fixture hash and the persisted identity, and throws on any unproven gate
      // instead of returning a partial pass.
      let verifyPptxOutput: ((input: unknown) => Promise<OracleEvidence>) | null = null;
      try {
        const oracleModule = (await import("../../scripts/office-g0/pptx-output-oracle.mjs")) as {
          verifyPptxOutput?: (input: unknown) => Promise<OracleEvidence>;
        };
        if (typeof oracleModule.verifyPptxOutput !== "function") {
          throw new Error("the module has no verifyPptxOutput export");
        }
        verifyPptxOutput = oracleModule.verifyPptxOutput;
      } catch (error) {
        throw new Error(
          "[office-g0] the independent pptx output oracle is not present at " +
            "scripts/office-g0/pptx-output-oracle.mjs (oracle lane): " + String((error as Error).message ?? error),
        );
      }
      const oracleEvidence = await verifyPptxOutput({
        fixturePath,
        savedPath,
        // Defect 2 fix: the reopened view's OWN working copy, so the oracle re-reads a
        // different file than savedPath and the reopen is actually proven.
        reopenedPath: reopened.workingPath,
        expectedMarker: EDIT_MARKER,
        target: TARGET,
      });
      expect(oracleEvidence.ok, "the oracle proves every persisted gate").toBe(true);
      expect(oracleEvidence.reopenedStable, "the oracle reports a stable fresh reopen").toBe(true);
      expect(oracleEvidence.fixturePath, "the oracle read the authored fixture").toBe(fixturePath);
      expect(oracleEvidence.savedPath, "the oracle read the published file").toBe(savedPath);
      expect(oracleEvidence.reopenedPath, "the oracle read the reopened view working copy").toBe(reopened.workingPath);
      expect(oracleEvidence.fixtureSha256).toBe(FIXTURE_SHA256);
      expect(oracleEvidence.savedSha256).toBe(sha256(savedBytes));
      expect(oracleEvidence.reopenedSha256, "the fresh reopen read the saved bytes").toBe(sha256(savedBytes));
      expect(oracleEvidence.savedDiffersFromFixture).toBe(true);
      expect(oracleEvidence.target?.markerPresent, "the marker is under the persisted target identity").toBe(true);

      // Defect 3: everything above has run; snapshot the live collectors only now.
      const diagnosticsAtGate = snapshotDiagnostics(diagnostics);
      const authoredAfterReopen = fs.readFileSync(fixturePath);
      // Published-output stability is kept SEPARATE from the reopen proof: the same saved file
      // is re-read here and must still hash to the bytes the save reported.
      const publishedStillBytes = fs.readFileSync(savedPath);
      const reopenedBytes = fs.readFileSync(reopened.workingPath);
      const diagnosticsClear =
        diagnosticsAtGate.transportFailures.length === 0 &&
        diagnosticsAtGate.consoleErrors.length === 0 &&
        diagnosticsAtGate.pageErrors.length === 0;
      const gates = {
        authoredFixtureUnchanged: sha256(authoredAfterReopen) === authoredHash,
        savedBytesChanged: !savedBytes.equals(authoredBytes),
        publishedDistinctFromWorkingAndFixture:
          savedPath !== realpathOf(opened.workingPath) && savedPath !== realpathOf(fixturePath),
        savedOutputStableAfterReopen: sha256(publishedStillBytes) === sha256(savedBytes),
        freshContextAndNewViewId:
          reopened.viewId !== opened.viewId && realpathOf(reopened.workingPath) !== savedPath,
        reopenedHashEqualsSaved: sha256(reopenedBytes) === sha256(savedBytes),
        markerVisibleInReopenedUi: true,
        oracleAllGatesGreen: oracleEvidence.ok && oracleEvidence.reopenedStable,
        diagnosticsClear,
      };
      await testInfo.attach("pptx-cycle-evidence.json", {
        body: JSON.stringify(
          {
            claim: Object.values(gates).every((value) => value === true)
              ? "browser-real PPTX open/edit/save/close/reopen completed every declared gate"
              : "run did not pass every declared gate; see gates and diagnostics",
            runtime: {
              node: process.version,
              browser: { name: browserName, version: browser.version() },
              os: { platform: process.platform, release: os.release(), arch: process.arch },
              labUrl: new URL(configuredBase).origin,
            },
            sourcePin,
            buildManifestSha256: manifestSha,
            fixture: { path: fixturePath, bytes: authoredBytes.length, sha256: authoredHash, sha256AfterReopen: sha256(authoredAfterReopen) },
            output: {
              path: savedPath,
              bytes: savedBytes.length,
              sha256: sha256(savedBytes),
              sha256AfterReopen: sha256(publishedStillBytes),
            },
            reopened: {
              viewId: reopened.viewId,
              path: reopened.path,
              workingPath: reopened.workingPath,
              bytes: reopenedBytes.length,
              sha256: sha256(reopenedBytes),
            },
            sessions: { initial: opened, reopened },
            target: TARGET,
            editMarker: EDIT_MARKER,
            committedRenderSlideHasMarker: true,
            oracleEvidence,
            uiOperations:
              "GET /slides/?fixture=<authored path>; observed lab:session-open/hash; double-clicked Text1's authored " +
              "glyph area in the Konva canvas; asserted the overlay carried the authored text; Ctrl+A; typed the marker; " +
              "Escape committed through the overlay; observed POST /lab/host:slides-edit-text and read the committed " +
              "RenderSlide; clicked the renderer's own Quick-Access Save button; observed POST /lab/host:slides-save; " +
              "realpath-checked and hashed the published file in <lab>/out/<viewId>; closed the context; opened the " +
              "published path in a fresh context; verified the reopened working copy bytes/hash; asserted the Outline " +
              "View DOM; ran the independent output oracle on the reopened working copy",
            gates,
            diagnostics: diagnosticsAtGate,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });

      expect(gates.authoredFixtureUnchanged, "authored fixture survives the cycle").toBe(true);
      expect(gates.savedBytesChanged, "the persisted output differs from the authored fixture").toBe(true);
      expect(gates.publishedDistinctFromWorkingAndFixture, "publication is distinct from working and fixture").toBe(true);
      expect(gates.savedOutputStableAfterReopen, "the published output is stable across the reopen").toBe(true);
      expect(gates.reopenedHashEqualsSaved, "the reopened working copy equals the saved bytes").toBe(true);
      expect(diagnosticsAtGate.transportFailures, "transport failures").toEqual([]);
      expect(diagnosticsAtGate.pageErrors, "page errors").toEqual([]);
      expect(diagnosticsAtGate.consoleErrors, "console errors").toEqual([]);
    }
  } catch (error) {
    // Defect 4: failure artifacts are best-effort and MUST NOT replace the original error.
    // The reopened context (if any) is always closed, even when newPage/openFixture failed.
    try {
      const shot = reopenedPage ?? page;
      await shot.screenshot({ fullPage: true }).then(
        (body) => testInfo.attach("pptx-failure.png", { body, contentType: "image/png" }),
        () => undefined,
      );
    } catch {
      // a screenshot failure is never the reason the run is red
    }
    try {
      await testInfo.attach("pptx-failure-evidence.json", {
        body: JSON.stringify(
          { error: String((error as Error).message ?? error), savedPath, diagnostics: snapshotDiagnostics(diagnostics) },
          null,
          2,
        ),
        contentType: "application/json",
      });
    } catch {
      // an attachment failure is never the reason the run is red
    }
    try {
      if (reopenedContext) await reopenedContext.close();
    } catch {
      // closing the context must not mask the original error either
    }
    throw error;
  }
});

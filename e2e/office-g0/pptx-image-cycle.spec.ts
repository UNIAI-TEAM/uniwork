// UNI-667 office-g0 PPTX existing-image cycle. Opens the deterministic image fixture in the
// pinned Slides renderer, selects the EXISTING target picture on the real Konva stage, replaces
// its pixels through the renderer's own Picture Format > "Replace Picture" control, saves with
// the renderer's own Quick-Access Save button, closes the browser context, and reopens the
// persisted bytes in a fresh context. No engine/save API is called by this test, no renderer
// state is assigned, no transport is faked; screenshots are attachments only and every gate
// below reads ACTUAL file bytes through the independent image oracle.
//
// The picker: the renderer calls window.slidesApi.pickPictureFile(), which upstream is an OS
// open dialog (ipc.ts:1354, slides-main.ts:2288-2305). The lab has no OS chooser, so the lab
// server's host:slides-pick-picture-file reads the OPERATOR-named, read-granted image for real.
// This test never injects a DOM <input type=file> and never fabricates the picked bytes: the
// replacement it expects is the very file the channel serves.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

const FIXTURE_NAME = (process.env.OFFICE_G0_PPTX_IMAGE_FIXTURE ?? "g0-image-slides.pptx").trim();
const REPLACEMENT_NAME = (process.env.OFFICE_G0_PPTX_IMAGE_REPLACEMENT ?? "g0-image-slides-replacement.png").trim();
const PINNED_FIXTURE_SHA256 = (process.env.OFFICE_G0_PPTX_IMAGE_FIXTURE_SHA256 ?? "").trim();
const PINNED_REPLACEMENT_SHA256 = (process.env.OFFICE_G0_PPTX_IMAGE_REPLACEMENT_SHA256 ?? "").trim();
const PINNED_AUTHORED_RGB_SHA256 = (process.env.OFFICE_G0_PPTX_IMAGE_AUTHORED_RGB_SHA256 ?? "").trim();
const PINNED_CONTROL_RGB_SHA256 = (process.env.OFFICE_G0_PPTX_IMAGE_CONTROL_RGB_SHA256 ?? "").trim();
const PINNED_REPLACEMENT_RGB_SHA256 = (process.env.OFFICE_G0_PPTX_IMAGE_REPLACEMENT_RGB_SHA256 ?? "").trim();
const SOURCE_PIN = "09485f884dc845cf3bf27fb7edfe489f9d457aad";
const IMAGE_SIZE = 16;
// The persisted identity of the picture this cycle edits, and of the OTHER picture on the
// same slide that must survive untouched (a wrong-target/lost-object detector).
const TARGET = { part: "ppt/slides/slide1.xml", kind: "pic", id: 3 };
const CONTROL = { part: "ppt/slides/slide1.xml", kind: "pic", id: 4 };
const PRESERVED_TITLE = "DOC-003 slide title";
const PRESERVED_SECOND = "Second slide";
const RIBBON_TAB = "Picture Tools";
const REPLACE_LABEL = "Replace Picture";
const fixturesDir = (process.env.OFFICE_G0_FIXTURES_DIR ?? "").trim();

type Diagnostics = { transportFailures: string[]; consoleErrors: string[]; pageErrors: string[] };
type SessionOpen = { viewId: string; app: string; path: string; name: string; hash: string; size: number; workingPath: string };
type SaveResult = { ok?: boolean; path?: string; savedPath?: string; bytes?: number; sha256?: string };
type SelectionReply = { status: "ok" | "not_ready" | "error"; result?: { slide: number; elements: string[]; types: string[] } };
type OracleEvidence = {
  oracle: string; version: number; ok: true;
  fixturePath: string; savedPath: string; reopenedPath: string; replacementPath: string;
  fixtureSha256: string; savedSha256: string; reopenedSha256: string;
  savedDiffersFromFixture: boolean; reopenedStable: boolean;
  identity?: { target?: { identityString?: string }; control?: { identityString?: string }; targetMatchCount?: number };
  target?: { found?: boolean; identity?: string | null; authoredEmbed?: string | null; savedEmbed?: string | null; authoredMediaPart?: string | null; savedMediaPart?: string | null; embedChanged?: boolean };
  control?: { found?: boolean; identity?: string | null; embedPreserved?: boolean; mediaPreserved?: boolean };
  media?: { savedTarget?: { sha256?: string; rgbSha256?: string; width?: number; height?: number }; savedControl?: { sha256?: string; rgbSha256?: string } };
  preflight?: { authoredTargetContract?: { ok?: boolean; rgbSha256?: string }; authoredFailsReplacementContract?: boolean | null };
  preservedParts?: { part: string; present: boolean; byteEqual: boolean }[];
  table?: { part: string; kind: string; id: number; found: boolean; cells: string[] | null; matches: boolean } | null;
  gates?: Record<string, boolean | null>;
};
type ImageEvidenceApi = {
  verifyPptxImageOutput(input: unknown): Promise<OracleEvidence>;
  decodePngRgb(bytes: Buffer, label?: string): { width: number; height: number; channels: number; rgb: Buffer; rgbSha256: string };
  sha256(bytes: Buffer): string;
  IMAGE_ORACLE_ID: string;
};

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** A required value; missing or malformed input is a named failure, never a skip. */
function requireEnv(name: string, pattern: RegExp, hint: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new Error("[office-g0] " + name + " is required: " + hint);
  if (!pattern.test(value)) throw new Error("[office-g0] " + name + " is malformed: " + value);
  return value;
}

/** The independent image oracle is a required dependency: a missing export fails by name. */
async function evidenceApi(): Promise<ImageEvidenceApi> {
  let helper: Record<string, unknown>;
  try {
    helper = (await import("../../scripts/office-g0/pptx-image-evidence.mjs")) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      "[office-g0] scripts/office-g0/pptx-image-evidence.mjs is required for image evidence: " +
        String((error as Error).message ?? error),
    );
  }
  for (const name of ["verifyPptxImageOutput", "decodePngRgb", "sha256"]) {
    if (typeof helper[name] !== "function") {
      throw new Error("[office-g0] pptx-image-evidence.mjs must export " + name + " as a function");
    }
  }
  return {
    verifyPptxImageOutput: helper["verifyPptxImageOutput"] as ImageEvidenceApi["verifyPptxImageOutput"],
    decodePngRgb: helper["decodePngRgb"] as ImageEvidenceApi["decodePngRgb"],
    sha256: helper["sha256"] as ImageEvidenceApi["sha256"],
    IMAGE_ORACLE_ID: String(helper["IMAGE_ORACLE_ID"] ?? ""),
  };
}

function observe(page: Page, sink: Diagnostics): Diagnostics {
  page.on("response", (response) => {
    if (response.status() >= 400) sink.transportFailures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
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
const emptyDiagnostics = (): Diagnostics => ({ transportFailures: [], consoleErrors: [], pageErrors: [] });
const snapshotDiagnostics = (sink: Diagnostics): Diagnostics => ({
  transportFailures: [...sink.transportFailures],
  consoleErrors: [...sink.consoleErrors],
  pageErrors: [...sink.pageErrors],
});

/** REALPATH-based containment, relative-based, so a junction out of the tree is caught. */
function isInsideReal(root: string, target: string): boolean {
  const resolvedRoot = fs.realpathSync(root);
  const resolvedTarget = fs.realpathSync(target);
  if (resolvedTarget === resolvedRoot) return true;
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The lab root and view directory of the CURRENT server-minted session, derived structurally. */
function viewDirOf(opened: SessionOpen): { labRoot: string; viewDir: string } {
  const workingDir = path.dirname(path.resolve(opened.workingPath));
  const viewDir = path.dirname(workingDir);
  const viewsRoot = path.dirname(viewDir);
  const labRoot = path.dirname(viewsRoot);
  if (path.basename(workingDir) !== "input") {
    throw new Error("[office-g0] the session working copy is not <lab>/views/<viewId>/input/<name>: " + opened.workingPath);
  }
  if (path.basename(viewsRoot) !== "views") {
    throw new Error("[office-g0] the session view is not under a lab 'views' root: " + opened.workingPath);
  }
  if (path.basename(viewDir) !== opened.viewId) {
    throw new Error("[office-g0] the session working copy lives in view '" + path.basename(viewDir) + "', not '" + opened.viewId + "'");
  }
  return { labRoot, viewDir };
}
const canonicalOutputDir = (opened: SessionOpen): string => path.join(viewDirOf(opened).labRoot, "out", opened.viewId);

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
    return (await (control as (req: unknown) => Promise<unknown>)({ cmd: "selection" })) as SelectionReply | null;
  });
}

/**
 * Selects the target picture by CLICKING it on the real Konva stage. The click is a real mouse
 * press at the picture's authored centre, so selection comes from the renderer's own hit test,
 * never from an assigned `__genofficeControl` selection.
 *
 * The authored target frame is x=5029200 y=731520 cx=1828800 cy=1371600 EMU on a 9144000x6858000
 * slide (screen4x3), and the stage renders at FIT_WIDTH=1280 px, so slide px = EMU / 9144000 * 1280.
 */
async function selectTargetPicture(page: Page): Promise<void> {
  const stage = page.locator(".stage-rel");
  const box = await stage.boundingBox();
  if (!box) throw new Error("[office-g0] the slide stage has no measurable box");
  const scale = box.width / 1280;
  const centreX = ((5029200 + 1828800 / 2) / 9144000) * 1280;
  const centreY = ((731520 + 1371600 / 2) / 6858000) * 1280;
  await page.mouse.click(box.x + centreX * scale, box.y + centreY * scale);
  // Identity in the UI: exactly the one target picture must be selected, and it must BE a
  // picture - a click that landed on the title or the table is a named failure here.
  await expect
    .poll(async () => {
      const reply = await selection(page);
      return reply?.result ? { count: reply.result.elements.length, types: reply.result.types.join(","), slide: reply.result.slide } : null;
    }, { message: "clicking the authored picture frame must select exactly one picture" })
    .toEqual({ count: 1, types: "picture", slide: 0 });
}

/**
 * Replaces the selected picture through the renderer's own Picture Format tab, then proves the
 * COMMITTED render tree carries the replacement: the picture node's dataUrl must hash to the
 * replacement PNG the lab picker actually serves. This reads the tree the renderer now holds, so
 * a no-op or a wrong-element result cannot pass.
 */
async function replacePictureThroughRibbon(page: Page, replacementSha: string): Promise<void> {
  // The contextual Picture Tools tab is offered only while a picture is selected; click it for
  // real rather than relying on the auto-switch.
  const tab = page.locator(".ribbon-tab", { hasText: new RegExp("^" + RIBBON_TAB + "$") });
  await expect(tab, "the Picture Tools contextual tab is offered for a selected picture").toHaveCount(1);
  await tab.first().click();
  const button = page.locator(".rb-big[data-tip='" + REPLACE_LABEL + "']");
  await expect(button, "the Replace Picture control is present").toHaveCount(1);
  await expect(button, "Replace Picture is enabled because a picture is selected").toBeEnabled();

  const observed = page.waitForResponse(
    (response) => response.url().includes("/lab/host:slides-replace-picture-bytes") && response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await button.click();
  const response = await observed;
  expect(response.ok(), "host:slides-replace-picture-bytes HTTP status").toBe(true);
  const envelope = await response.json();
  expect(envelope.ok, "host:slides-replace-picture-bytes envelope").toBe(true);
  // The applied channel answers the committed RenderSlide (lab-server unwraps result.slide), and
  // that tree must carry the replacement pixels under the target picture.
  const committed = envelope.result as { nodes?: unknown[] } | null;
  expect(Array.isArray(committed?.nodes), "the channel answers a RenderSlide").toBe(true);
  const dataUrls = collectPictureDataUrls(committed as { nodes?: NodeShape[] });
  expect(dataUrls.length, "the committed slide still carries its pictures").toBeGreaterThan(0);
  const matched = dataUrls.filter((entry) => sha256(Buffer.from(entry.split(",")[1] ?? "", "base64")) === replacementSha);
  expect(matched.length, "exactly one picture in the committed tree is the replacement PNG").toBe(1);
}

type NodeShape = { type?: string; dataUrl?: string; children?: NodeShape[] };
function collectPictureDataUrls(slide: { nodes?: NodeShape[] }): string[] {
  const found: string[] = [];
  const walk = (nodes: NodeShape[] | undefined) => {
    for (const node of nodes ?? []) {
      if (node.type === "picture" && typeof node.dataUrl === "string") found.push(node.dataUrl);
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(slide.nodes);
  return found;
}

test("pptx image: replace the existing slide picture through the real UI, save, and reopen", async (
  { page, browser, browserName },
  testInfo,
) => {
  const sourcePin = requireEnv("OFFICE_G0_SOURCE_PIN", /^[0-9a-f]{40}$/, "the pinned source commit");
  const manifestSha = requireEnv("OFFICE_G0_BUILD_MANIFEST_SHA256", /^[0-9a-f]{64}$/, "the approved build manifest digest");
  expect(sourcePin, "the run is pinned to the frozen source commit").toBe(SOURCE_PIN);
  expect(fixturesDir, "OFFICE_G0_FIXTURES_DIR must be provided by the runner").not.toBe("");
  expect(PINNED_FIXTURE_SHA256, "OFFICE_G0_PPTX_IMAGE_FIXTURE_SHA256 must pin the authored deck").toMatch(/^[0-9a-f]{64}$/);
  expect(PINNED_REPLACEMENT_SHA256, "OFFICE_G0_PPTX_IMAGE_REPLACEMENT_SHA256 must pin the replacement").toMatch(/^[0-9a-f]{64}$/);
  expect(PINNED_REPLACEMENT_RGB_SHA256, "the replacement pixel pin must be present").toMatch(/^[0-9a-f]{64}$/);
  expect(PINNED_AUTHORED_RGB_SHA256, "the authored pixel pin must be present").toMatch(/^[0-9a-f]{64}$/);
  expect(PINNED_CONTROL_RGB_SHA256, "the control pixel pin must be present").toMatch(/^[0-9a-f]{64}$/);
  const api = await evidenceApi();

  const fixturePath = path.join(fixturesDir, FIXTURE_NAME);
  const replacementPath = path.join(fixturesDir, REPLACEMENT_NAME);
  const authoredBytes = fs.readFileSync(fixturePath);
  const replacementBytes = fs.readFileSync(replacementPath);
  const authoredHash = sha256(authoredBytes);
  expect(authoredHash, "the authored deck is the pinned one").toBe(PINNED_FIXTURE_SHA256);
  expect(sha256(replacementBytes), "the replacement is the pinned file").toBe(PINNED_REPLACEMENT_SHA256);
  // The three deterministic images are distinct at the PIXEL level too, so a re-encode that
  // happens to preserve the container length still cannot be mistaken for another image.
  expect(api.decodePngRgb(replacementBytes, "replacement").rgbSha256).toBe(PINNED_REPLACEMENT_RGB_SHA256);
  expect(new Set([PINNED_AUTHORED_RGB_SHA256, PINNED_CONTROL_RGB_SHA256, PINNED_REPLACEMENT_RGB_SHA256]).size).toBe(3);

  let savedPath: string | null = null;
  let reopenedPage: Page | null = null;
  let reopenedContext: BrowserContext | null = null;
  const diagnostics = emptyDiagnostics();
  observe(page, diagnostics);
  try {
    const opened = await openFixture(page, fixturePath, authoredHash);
    await waitForEditor(page);

    await selectTargetPicture(page);
    const stageShot = await page.locator(".stage-rel").screenshot();
    await testInfo.attach("pptx-image-before.png", { body: stageShot, contentType: "image/png" });

    await replacePictureThroughRibbon(page, PINNED_REPLACEMENT_SHA256);
    await expect(page.locator("button.qa-btn[aria-label*='Save']")).toBeEnabled(); // setDirty(true) after the commit
    await testInfo.attach("pptx-image-after-edit.png", { body: await page.locator(".stage-rel").screenshot(), contentType: "image/png" });

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
    expect(path.dirname(savedPath), "the publication's real directory is <lab>/out/<viewId>").toBe(fs.realpathSync(nativeOutDir));
    expect(isInsideReal(nativeOutDir, savedPath), "realpath containment in <lab>/out/<viewId>").toBe(true);
    expect(savedPath, "the publication is distinct from the pre-save working copy").not.toBe(fs.realpathSync(opened.workingPath));
    expect(savedPath, "the authored fixture is never the save target").not.toBe(fs.realpathSync(fixturePath));
    const savedBytes = fs.readFileSync(savedPath);
    expect(savedBytes.length).toBe(saved.bytes);
    expect(sha256(savedBytes), "the reported checksum is the bytes on disk").toBe(saved.sha256);
    expect(savedBytes.equals(authoredBytes), "the saved package really changed").toBe(false);
    expect(sha256(fs.readFileSync(fixturePath)), "authored fixture unchanged after save").toBe(authoredHash);
    expect(fs.readFileSync(opened.workingPath).equals(authoredBytes), "the pre-save working copy is unmodified").toBe(true);

    await page.context().close();
    const configuredBase = testInfo.project.use.baseURL;
    if (!configuredBase) throw new Error("[office-g0] the project must provide use.baseURL for the reopened context");
    reopenedContext = await browser.newContext({
      baseURL: new URL(configuredBase).origin,
      locale: "en-US",
      viewport: { width: 1280, height: 800 },
    });
    reopenedPage = await reopenedContext.newPage();
    observe(reopenedPage, diagnostics);
    {
      const reopened = await openFixture(reopenedPage, savedPath, sha256(savedBytes));
      expect(reopened.viewId, "the reopen is a NEW server-minted view").not.toBe(opened.viewId);
      expect(reopened.path, "the reopened session consumed the published file").toBe(savedPath);
      await waitForEditor(reopenedPage);
      expect(reopened.workingPath, "the reopened view has its own working copy").not.toBe(savedPath);
      expect(reopened.hash, "the reopened session hash is the saved bytes on disk").toBe(sha256(savedBytes));
      const reopenedWorking = fs.realpathSync(reopened.workingPath);
      expect(isInsideReal(path.join(viewDirOf(reopened).viewDir, "input"), reopenedWorking), "the reopened copy is in its own view").toBe(true);
      const reopenedBytes = fs.readFileSync(reopenedWorking);
      expect(sha256(reopenedBytes), "the reopened working copy bytes equal the saved bytes").toBe(sha256(savedBytes));

      // The reopened UI must still show the deck (a real render, not a blank stage).
      await expect(reopenedPage.locator(".stage-rel canvas").first()).toBeVisible();
      await expect(reopenedPage.locator("body")).not.toContainText("lab host bootstrap failed");
      await testInfo.attach("pptx-image-reopen.png", { body: await reopenedPage.screenshot({ fullPage: true }), contentType: "image/png" });

      const expected = {
        target: TARGET,
        control: CONTROL,
        authored: {
          target: { width: IMAGE_SIZE, height: IMAGE_SIZE, rgbSha256: PINNED_AUTHORED_RGB_SHA256 },
          control: { width: IMAGE_SIZE, height: IMAGE_SIZE, rgbSha256: PINNED_CONTROL_RGB_SHA256 },
        },
        replacement: { width: IMAGE_SIZE, height: IMAGE_SIZE, rgbSha256: PINNED_REPLACEMENT_RGB_SHA256, sha256: PINNED_REPLACEMENT_SHA256 },
        slideParts: ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"],
        // Parts the replacement must leave byte-identical. The oracle REFUSES an empty list, so
        // this is a real preservation claim. The target slide part and its rels are absent on
        // purpose (the blip's r:embed and a relationship really change), as is the authored media
        // part the target no longer references and the new replacement media part.
        preservedParts: [
          "[Content_Types].xml",
          "_rels/.rels",
          "docProps/core.xml",
          "ppt/_rels/presentation.xml.rels",
          "ppt/media/image2.png",
          "ppt/presentation.xml",
          "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
          "ppt/slideLayouts/slideLayout1.xml",
          "ppt/slideMasters/_rels/slideMaster1.xml.rels",
          "ppt/slideMasters/slideMaster1.xml",
          "ppt/slides/_rels/slide2.xml.rels",
          "ppt/slides/slide2.xml",
          "ppt/theme/theme1.xml",
        ],
        // The unrelated table that rides on the same slide; a deleted graphicFrame would be
        // invisible to the two text rows above, so its cells are compared explicitly.
        table: {
          part: "ppt/slides/slide1.xml",
          kind: "graphicFrame",
          id: 5,
          cells: ["Feature", "Value", "formula", "=SUM(A1:A2)"],
        },
        preserved: [
          { part: "ppt/slides/slide1.xml", kind: "sp", id: 2, text: PRESERVED_TITLE },
          { part: "ppt/slides/slide2.xml", kind: "sp", id: 2, text: PRESERVED_SECOND },
        ],
        fixtureSha256: PINNED_FIXTURE_SHA256,
      };
      // Authoritative, independent persisted-output proof. It THROWS on any unproven gate, so a
      // returned object is always ok:true and always carries the bound paths.
      const oracleEvidence = await api.verifyPptxImageOutput({
        fixturePath,
        savedPath,
        reopenedPath: reopened.workingPath,
        replacementPath,
        expected,
      });
      expect(oracleEvidence.ok, "the oracle proves every persisted gate").toBe(true);
      expect(oracleEvidence.reopenedStable, "the oracle reports a stable fresh reopen").toBe(true);
      expect(oracleEvidence.target?.identity, "the credited picture is the persisted target identity").toBe(TARGET.part + "#pic#" + TARGET.id);
      expect(oracleEvidence.target?.embedChanged, "the target's blip relationship really changed").toBe(true);
      expect(oracleEvidence.target?.savedMediaPart, "the target points at a NEW media part").not.toBe(oracleEvidence.target?.authoredMediaPart);
      expect(oracleEvidence.control?.identity, "the control picture is the OTHER persisted identity").toBe(CONTROL.part + "#pic#" + CONTROL.id);
      expect(oracleEvidence.control?.embedPreserved, "the control picture kept its relationship").toBe(true);
      expect(oracleEvidence.control?.mediaPreserved, "the control picture kept its media bytes").toBe(true);
      expect(oracleEvidence.media?.savedTarget?.sha256, "the on-disk target media IS the replacement PNG").toBe(PINNED_REPLACEMENT_SHA256);
      expect(oracleEvidence.media?.savedTarget?.rgbSha256, "the on-disk target pixels are the pinned replacement").toBe(PINNED_REPLACEMENT_RGB_SHA256);
      expect(oracleEvidence.media?.savedControl?.rgbSha256, "the control pixels are still the authored control").toBe(PINNED_CONTROL_RGB_SHA256);
      // Independent negative preflight: the SAME validator the oracle credits the saved output
      // with must reject the authored bytes by name, so a metadata-only save cannot pass.
      expect(oracleEvidence.preflight?.authoredTargetContract?.ok, "the authored deck satisfies the AUTHORED contract").toBe(true);
      expect(oracleEvidence.preflight?.authoredFailsReplacementContract, "the authored bytes fail the replacement contract").toBe(true);
      // Preservation is a CLAIM, not a vacuous pass: the oracle refuses an empty part list, so
      // the credited package must show real, compared, byte-equal unrelated parts.
      expect(oracleEvidence.gates?.preservedPartsDeclared, "the preserved-part list is non-empty").toBe(true);
      expect(oracleEvidence.gates?.preservedPartsByteEqual, "every declared unrelated part is byte-equal").toBe(true);
      expect(oracleEvidence.preservedParts?.length ?? 0, "the oracle compared a real part list").toBeGreaterThan(0);
      expect(
        oracleEvidence.preservedParts?.every((entry) => entry.present && entry.byteEqual),
        "no declared part is missing or changed",
      ).toBe(true);
      expect(oracleEvidence.gates?.tableContentMatches, "the unrelated table's cells survived").toBe(true);
      expect(oracleEvidence.table?.found, "the persisted table is still on the slide").toBe(true);

      const diagnosticsAtGate = snapshotDiagnostics(diagnostics);
      const diagnosticsClear =
        diagnosticsAtGate.transportFailures.length === 0 &&
        diagnosticsAtGate.consoleErrors.length === 0 &&
        diagnosticsAtGate.pageErrors.length === 0;
      await testInfo.attach("pptx-image-cycle-evidence.json", {
        body: JSON.stringify(
          {
            claim:
              oracleEvidence.ok && diagnosticsClear
                ? "browser-real PPTX existing-picture replacement, normal save and distinct-view reopen completed every declared gate"
                : "run did not pass every declared gate; see gates and diagnostics",
            runtime: {
              node: process.version,
              browser: { name: browserName, version: browser.version() },
              os: { platform: process.platform, release: os.release(), arch: process.arch },
              labUrl: new URL(configuredBase).origin,
              note: "the installed Chrome/Edge projects only; the Orca embedded Chromium is a different product and is not claimed here",
            },
            sourcePin,
            buildManifestSha256: manifestSha,
            fixture: { path: fixturePath, bytes: authoredBytes.length, sha256: authoredHash, sha256AfterReopen: sha256(fs.readFileSync(fixturePath)) },
            replacement: { path: replacementPath, bytes: replacementBytes.length, sha256: PINNED_REPLACEMENT_SHA256, rgbSha256: PINNED_REPLACEMENT_RGB_SHA256 },
            output: {
              path: savedPath,
              bytes: savedBytes.length,
              sha256: sha256(savedBytes),
              sha256AfterReopen: sha256(fs.readFileSync(savedPath)),
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
            control: CONTROL,
            uiOperations:
              "GET /slides/?fixture=<authored path>; observed lab:session-open/hash; clicked the authored target picture's centre on the real " +
              "Konva stage and asserted the renderer's own selection reply named exactly one picture; clicked the Picture Tools contextual tab; " +
              "clicked the enabled Replace Picture control; observed POST /lab/host:slides-replace-picture-bytes and read the committed RenderSlide; " +
              "asserted exactly one committed picture hashes to the replacement PNG; clicked the renderer's own Quick-Access Save button; " +
              "observed POST /lab/host:slides-save; realpath-checked and hashed the published file in <lab>/out/<viewId>; closed the context; " +
              "opened the published path in a fresh context; verified the reopened working copy bytes/hash; ran the independent image oracle " +
              "on the reopened working copy",
            oracleEvidence,
            gates: {
              authoredFixtureUnchanged: sha256(fs.readFileSync(fixturePath)) === authoredHash,
              savedBytesChanged: !savedBytes.equals(authoredBytes),
              savedOutputStableAfterReopen: sha256(fs.readFileSync(savedPath)) === sha256(savedBytes),
              freshContextAndNewViewId: reopened.viewId !== opened.viewId,
              reopenedHashEqualsSaved: sha256(reopenedBytes) === sha256(savedBytes),
              oracleAllGatesGreen: oracleEvidence.ok && oracleEvidence.reopenedStable,
              diagnosticsClear,
            },
            diagnostics: diagnosticsAtGate,
          },
          null,
          2,
        ),
        contentType: "application/json",
      });

      expect(diagnosticsAtGate.transportFailures, "transport failures").toEqual([]);
      expect(diagnosticsAtGate.pageErrors, "page errors").toEqual([]);
      expect(diagnosticsAtGate.consoleErrors, "console errors").toEqual([]);
    }
  } catch (error) {
    try {
      const shot = reopenedPage ?? page;
      await shot.screenshot({ fullPage: true }).then(
        (body) => testInfo.attach("pptx-image-failure.png", { body, contentType: "image/png" }),
        () => undefined,
      );
    } catch {
      // a screenshot failure is never the reason the run is red
    }
    try {
      await testInfo.attach("pptx-image-failure-evidence.json", {
        body: JSON.stringify({ error: String((error as Error).message ?? error), savedPath, diagnostics: snapshotDiagnostics(diagnostics) }, null, 2),
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

// applyPdfEditBytes: how skips and refusals surface to the caller — warnings
// text, report counters, typed errors for bad page-op sources and corrupt input.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applyPdfEditBytes, PdfTypedError } from "./adapter";

const FIXTURES = fileURLToPath(new URL("../../../../docs/office/g0/fixtures/files/pdf/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(FIXTURES + name));

async function refused(p: Promise<unknown>): Promise<PdfTypedError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(PdfTypedError);
    return e as PdfTypedError;
  }
  throw new Error("expected a typed refusal");
}

describe("applyPdfEditBytes skips and warnings", () => {
  it("turns skipped note, annotation and image edits into 1-based edit_skipped warnings and report counts", async () => {
    const out = await applyPdfEditBytes(fixture("pdf-image.pdf"), [
      { op: "addNote", attributes: { pageIndex: 9, rect: [10, 10, 30, 30], contents: "lost" } },
      { op: "editSavedNote", attributes: { pageIndex: 9, objNum: 1, rect: [1, 1, 2, 2], oldContents: "a", contents: "b" } },
      { op: "deleteSavedAnnot", attributes: { pageIndex: 0, objNum: 9, subtype: "highlight", rect: [1, 1, 5, 5] } },
      { op: "addImageEdit", attributes: { kind: "deleteImage", pageIndex: 0, oldRect: [300, 300, 340, 340] } },
    ]);
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        { code: "edit_skipped", detail: "note page=10: page out of range" },
        { code: "edit_skipped", detail: "note-edit page=10: page out of range" },
        { code: "edit_skipped", detail: "annot page=1: no matching annotation" },
        { code: "edit_skipped", detail: "image page=1: the image could not be located on the page" },
      ]),
    );
    expect(out.report.notes).toEqual({ applied: 0, skipped: 1 });
    expect(out.report.noteEdits).toEqual({ applied: 0, skipped: 1 });
    expect(out.report.annotDeletes).toEqual({ applied: 0, skipped: 1 });
    expect(out.report.imageEdits).toEqual({ applied: 0, skipped: 1 });
  });

  it("reports page-structure ops that were requested against a missing anchor", async () => {
    const out = await applyPdfEditBytes(fixture("pdf-image.pdf"), [
      { op: "insertBlankPage", attributes: { afterPageIndex: 8 } },
    ]);
    expect(out.report.blankPages).toEqual({ applied: 0, skipped: 1 });
    expect(out.warnings.some((w) => w.detail?.startsWith("insertBlankPage #1:"))).toBe(true);
  });
});

describe("applyPdfEditBytes refusals", () => {
  it("refuses a source pdf that is not valid base64 as a typed bad_op", async () => {
    const e = await refused(
      applyPdfEditBytes(fixture("pdf-image.pdf"), [{ op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: "not base64!!" } }]),
    );
    expect(e.code).toBe("engine_result_invalid");
    expect(e.reason).toContain("bad_op:insertPdfPages");
    expect(e.reason).toContain("not valid base64");
  });

  it("refuses an inserted source that decodes to a non-pdf, leaving the job without output", async () => {
    const e = await refused(
      applyPdfEditBytes(fixture("pdf-image.pdf"), [
        { op: "insertPdfPages", attributes: { afterPageIndex: 0, pdf: Buffer.from("this is not a pdf").toString("base64") } },
      ]),
    );
    expect(e.code).toBe("engine_result_invalid");
  });

  it("refuses an encrypted document on the edit path", async () => {
    const e = await refused(applyPdfEditBytes(fixture("pdf-password-4spaces.pdf"), []));
    expect(e.reason).toBe("encrypted_pdf");
  });

  it("refuses a corrupt document", async () => {
    const e = await refused(applyPdfEditBytes(fixture("pdf-corrupt.pdf"), []));
    expect(e.code).toBe("engine_result_invalid");
  });
});

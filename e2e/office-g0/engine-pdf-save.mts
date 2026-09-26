// DOC-003 engine host: the real SavePdfRequest pipeline for the PDF routes.
//
// The renderer sends the upstream SavePdfRequest shape (no bytes field). The one
// call that applies AND verifies it is savePdfToPath: it reads the source file,
// runs applySaveRequest, verifies text/image edits against the result, and writes
// atomically. This module calls it exactly once per save and never re-applies the
// same edits (applyTextEdits + verifyTextEdits would be a second application).
//
// Two upstream constraints are handled here, not papered over:
//  - save-pdf.ts dynamically imports ./image-edit only when imageEdits is
//    non-empty, and image-edit.ts statically imports Electron''s nativeImage. The
//    content-stream image operations are therefore applied FIRST by this host''s
//    own Node decoder adapter (engine-pdf.mts, pngjs + pdfium) onto a staging
//    copy, and the request handed to savePdfToPath no longer carries imageEdits.
//  - staticFormFills / listEditFonts / canDrawText are real upstream exports and
//    are exposed to the renderer unchanged.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PdfEngineError, type PdfEngine } from "./engine-pdf.mts";
import { sha256 } from "./engine-paths.mts";

/** The upstream SavePdfRequest. Only the fields this host reads or forwards. */
export interface PdfSaveRequestLike {
  path: string;
  targetPath?: string;
  markups?: unknown[];
  annotDeletes?: unknown[];
  drawings?: unknown[];
  noteEdits?: unknown[];
  formValues?: unknown[];
  stamps?: unknown[];
  textEdits?: unknown[];
  textInserts?: unknown[];
  imageEdits?: { kind: string; pageIndex: number; rect?: number[]; oldRect?: number[]; image?: string }[];
  staticFormFills?: unknown[];
  rotations?: unknown[];
  deletedPages?: number[];
  pageOrder?: number[];
  metadata?: unknown;
}

export interface PdfSaveSkips {
  skippedTextEdits?: { pageIndex: number; oldText: string; reason: string }[];
  skippedTextInserts?: { editIndex: number; pageIndex: number; reason: string }[];
  skippedImageEdits?: { editIndex: number; pageIndex: number; reason: string }[];
}

export interface PdfSaveSummary extends PdfSaveSkips {
  path: string;
  bytes: number;
  sha256: string;
  imageEditsApplied: number;
}

export interface PdfRequestApi {
  saveRequest(input: {
    sourcePath: string;
    targetPath: string;
    stagingPath: string;
    request: PdfSaveRequestLike;
  }): Promise<PdfSaveSummary>;
  listEditFonts(): string[];
  canDrawText(text: string, font?: string, bold?: boolean, italic?: boolean): boolean;
  listStaticFormFills(bytes: Uint8Array): Promise<unknown[]>;
}

interface SavePdfModule {
  savePdfToPath: (
    sourcePath: string,
    targetPath: string,
    request: PdfSaveRequestLike,
  ) => Promise<PdfSaveSkips>;
  readStaticFormFills: (bytes: Uint8Array) => Promise<unknown[]>;
}

interface TextEditModule {
  listEditFonts: () => string[];
  canDrawText: (text: string, font?: string, bold?: boolean, italic?: boolean) => boolean;
}

/** Load the modules that make up the upstream save pipeline (all Electron-free). */
export async function createPdfRequestApi(sourceRoot: string, pdf: PdfEngine): Promise<PdfRequestApi> {
  const load = <T,>(relative: string): Promise<T> =>
    import(pathToFileURL(join(sourceRoot, relative)).href) as Promise<T>;
  const savePdf = await load<SavePdfModule>("apps/pdf/src/main/save-pdf.ts");
  const textEdit = await load<TextEditModule>("apps/pdf/src/main/text-edit.ts");

  const applyImageEdits = async (
    bytes: Uint8Array,
    imageEdits: NonNullable<PdfSaveRequestLike["imageEdits"]>,
  ): Promise<Uint8Array> => {
    let current = bytes;
    for (const edit of imageEdits) {
      if (edit.kind === "deleteImage") {
        throw new PdfEngineError(
          "image_op_unsupported",
          "the Node image adapter implements replaceImage only; deleteImage would need Electron nativeImage",
        );
      }
      if (edit.kind !== "replaceImage" || typeof edit.image !== "string") {
        throw new PdfEngineError(
          "image_op_unsupported",
          "the Node image adapter implements replaceImage only, not " + edit.kind,
        );
      }
      const rect = (edit.rect ?? edit.oldRect) as [number, number, number, number] | undefined;
      if (!rect || rect.length !== 4) {
        throw new PdfEngineError("bad_input", "a replaceImage edit needs a 4-number rect");
      }
      const result = await pdf.replaceImage(current, {
        kind: "replaceImage",
        pageIndex: edit.pageIndex,
        oldRect: rect,
        rect,
        image: edit.image,
      });
      current = result.bytes;
    }
    return current;
  };

  return {
    async saveRequest({ sourcePath, targetPath, stagingPath, request }) {
      const imageEdits = request.imageEdits ?? [];
      let pipelineSource = sourcePath;
      let appliedImages = 0;
      if (imageEdits.length > 0) {
        const source = new Uint8Array(await readFile(sourcePath));
        const withImages = await applyImageEdits(source, imageEdits);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(stagingPath, withImages);
        pipelineSource = stagingPath;
        appliedImages = imageEdits.length;
      }
      const forwarded: PdfSaveRequestLike = { ...request, imageEdits: [] };
      const skips = await savePdf.savePdfToPath(pipelineSource, targetPath, forwarded);
      const written = new Uint8Array(await readFile(targetPath));
      if (written.length === 0) {
        throw new PdfEngineError("save_empty", "savePdfToPath produced a 0-byte file");
      }
      return {
        path: targetPath,
        bytes: written.length,
        sha256: sha256(written),
        imageEditsApplied: appliedImages,
        skippedTextEdits: skips.skippedTextEdits,
        skippedTextInserts: skips.skippedTextInserts,
        skippedImageEdits: skips.skippedImageEdits,
      };
    },

    listEditFonts: () => textEdit.listEditFonts(),

    canDrawText: (text, font, bold, italic) => textEdit.canDrawText(text, font, bold, italic),

    listStaticFormFills: (bytes) => savePdf.readStaticFormFills(bytes),
  };
}

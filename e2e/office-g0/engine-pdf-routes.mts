// DOC-003 engine host: PDF routes on the real upstream text/image engines.
//
// Text path (upstream apps/pdf/src/main/text-edit.ts):
//   validateTextEdits -> applyTextEdits -> verifyTextEdits, then a staged write.
//   savePdfToPath is deliberately not used here either: it re-applies the same
//   edits, so a text save goes through the three explicit stages instead.
//
// Save path (renderer API): the renderer sends the real SavePdfRequest; the one
// upstream call that applies AND verifies it is savePdfToPath, which this host
// invokes exactly once (see engine-pdf-save.mts). Never a byte echo, never a
// 0-byte write: a save that produces nothing fails.
//
// Image path: upstream''s content-stream image ops live in
// apps/pdf/src/main/image-edit.ts, which statically imports Electron''s
// nativeImage. This host carries an explicit Node decoder adapter instead: PNG
// bytes are decoded with pngjs (resolved from the prepared source tree) into
// straight-alpha BGRA, handed to pdfium''s _FPDFImageObj_SetBitmap, and the page
// content stream is regenerated. Every image route reports
// decoder: "pngjs" or fails with image_decoder_missing.
import { basename, join } from "node:path";
import { safeName, snapshotCopy } from "./engine-paths.mts";
import type { HostContext, RouteMap } from "./engine-host-context.mts";
import {
  EngineRequestError,
  optionalNumber,
  optionalString,
  requireArray,
  requireString,
} from "./engine-host-context.mts";
import type { PdfEngine, TextEditInputLike } from "./engine-pdf.mts";
import { createPdfRequestApi, type PdfRequestApi, type PdfSaveRequestLike } from "./engine-pdf-save.mts";

const parseEdit = (value: unknown, index: number): TextEditInputLike => {
  if (typeof value !== "object" || value === null) {
    throw new EngineRequestError("bad_input", "textEdits[" + index + "] must be an object");
  }
  const edit = value as Record<string, unknown>;
  const rect = edit.rect;
  if (!Array.isArray(rect) || rect.length !== 4 || rect.some((n) => typeof n !== "number")) {
    throw new EngineRequestError("bad_input", "textEdits[" + index + "].rect must be 4 numbers");
  }
  return {
    ...edit,
    pageIndex: Number(edit.pageIndex ?? 0),
    rect: rect as [number, number, number, number],
    oldText: requireString(edit.oldText, "textEdits[" + index + "].oldText"),
    newText: requireString(edit.newText, "textEdits[" + index + "].newText"),
    fontSize: Number(edit.fontSize ?? 14),
  } as TextEditInputLike;
};

export function createPdfRoutes(ctx: HostContext): { routes: RouteMap; requestApi: () => Promise<PdfRequestApi> } {
  let apiPromise: Promise<PdfRequestApi> | null = null;
  /**
   * The save pipeline loads only when a route that needs it is called: building
   * the host must not import the upstream PDF modules or start the pdf engine.
   */
  const requestApi = (): Promise<PdfRequestApi> => {
    if (!apiPromise) {
      apiPromise = ctx.engines.pdf.then((pdf) => createPdfRequestApi(ctx.source, pdf));
      apiPromise.catch(() => undefined);
    }
    return apiPromise;
  };
  const pdfOf = (): Promise<PdfEngine> => ctx.engines.pdf;

  /** Stage a write and report real bytes/hash: no route may claim a save it did not do. */
  const stagePdf = async (viewId: string, name: string, bytes: Uint8Array): Promise<Record<string, unknown>> => {
    const path = await ctx.stage(viewId, name, bytes);
    return { path, outBytes: bytes.length, outHash: ctx.sha256(bytes) };
  };

  const outName = (input: Record<string, unknown>, fallbackPath: string): string => {
    const requested = optionalString(input.name, "name");
    if (requested) return safeName(requested);
    const targetPath = optionalString(input.targetPath, "targetPath");
    // save-request writes targetPath directly, not through ctx.stage: keep the
    // name one safe basename so no pdf save can leave the view's out directory.
    return safeName(basename(targetPath ?? fallbackPath));
  };

  const routes: RouteMap = {
    "/engine/pdf-text-read": async (input) => {
      const pdf = await pdfOf();
      return pdf.readPdfText(new Uint8Array(await ctx.read(input.path)));
    },

    "/engine/pdf-fonts": async (input) => {
      const api = await requestApi();
      const text = optionalString(input.text, "text") ?? "DOC-003 lab text";
      const font = optionalString(input.font, "font");
      return {
        fonts: api.listEditFonts(),
        canDrawText: api.canDrawText(text, font, input.bold === true, input.italic === true),
      };
    },

    "/engine/pdf-validate-text": async (input) => {
      const pdf = await pdfOf();
      const edits = requireArray<unknown>(input.textEdits, "textEdits").map(parseEdit);
      return { validation: await pdf.validateTextEdits(new Uint8Array(await ctx.read(input.path)), edits) };
    },

    "/engine/pdf-save-text": async (input) => {
      // Validate the view id before the pdf engine starts or a snapshot dir is made.
      const viewId = ctx.requireViewId(input.viewId);
      const sourcePath = ctx.labFile(input.path);
      const pdf = await pdfOf();
      const copy = await snapshotCopy(ctx.sessionDir(viewId), sourcePath);
      const source = new Uint8Array(await ctx.read(copy.path));
      const edits = requireArray<unknown>(input.textEdits, "textEdits").map(parseEdit);
      const applied = await pdf.applyTextEdits(source, edits);
      const staged = await stagePdf(viewId, outName(input, sourcePath), applied.bytes);
      return {
        ...staged,
        inBytes: copy.bytes,
        inHash: copy.hash,
        skipped: applied.skipped,
        verifyFailures: applied.failures,
        oldTextGone: !applied.afterText.includes(edits[0]?.oldText ?? ""),
        newTextPresent: applied.afterText.includes(edits[0]?.newText ?? ""),
        beforeChars: applied.beforeText.length,
        afterChars: applied.afterText.length,
      };
    },

    // The renderer''s real save: one savePdfToPath call on a lab copy, result written
    // atomically. A skipped text/image edit is reported, never swallowed.
    "/engine/pdf-save-request": async (input) => {
      const request = input.request;
      if (typeof request !== "object" || request === null) {
        throw new EngineRequestError("bad_input", "a pdf save needs the real SavePdfRequest in request");
      }
      const saveRequest = request as PdfSaveRequestLike;
      const viewId = requireString(input.viewId, "viewId");
      const sourcePath = ctx.labFile(input.path ?? saveRequest.path);
      const copy = await snapshotCopy(ctx.sessionDir(viewId), sourcePath);
      const name = outName(input, sourcePath);
      // The engine's own atomic writer stages "<target>.gensave-<pid>.tmp" BESIDE
      // the target (apps/pdf/src/main/atomic-write.ts), so a targetPath inside a
      // view output directory that does not exist yet fails the whole save with a
      // bare ENOENT. Create THIS view's directory first, contained and re-proven,
      // so the publication target the engine is handed is always writable.
      const targetPath = join(await ctx.ensureOutDir(viewId), name);
      const stagingPath = join(ctx.sessionDir(viewId), "image-stage.pdf");
      const api = await requestApi();
      const summary = await api.saveRequest({
        sourcePath: copy.path,
        targetPath,
        stagingPath,
        request: { ...saveRequest, path: copy.path },
      });
      return { ok: true, ...summary, inBytes: copy.bytes, inHash: copy.hash };
    },

    "/engine/pdf-list-images": async (input) => {
      const pdf = await pdfOf();
      return { images: await pdf.listImages(new Uint8Array(await ctx.read(input.path))) };
    },

    "/engine/pdf-replace-image": async (input) => {
      const viewId = ctx.requireViewId(input.viewId);
      const sourcePath = ctx.labFile(input.path);
      const pdf = await pdfOf();
      const copy = await snapshotCopy(ctx.sessionDir(viewId), sourcePath);
      const source = new Uint8Array(await ctx.read(copy.path));
      const oldRect = (input.oldRect ?? input.rect) as [number, number, number, number];
      const rect = (input.rect ?? input.oldRect) as [number, number, number, number];
      const result = await pdf.replaceImage(source, {
        kind: "replaceImage",
        pageIndex: optionalNumber(input.pageIndex, "pageIndex") ?? 0,
        oldRect,
        rect,
        image: requireString(input.image, "image"),
      });
      const staged = await stagePdf(viewId, outName(input, sourcePath), result.bytes);
      return {
        ...staged,
        inBytes: copy.bytes,
        inHash: copy.hash,
        decoder: result.decoder,
        decoded: { width: result.width, height: result.height },
        renderedPixels: result.renderedPixels,
        renderChanged: result.renderChanged,
        imageStillListed: (await pdf.listImages(result.bytes)).length > 0,
      };
    },

    "/engine/pdf-list-form-fills": async (input) => {
      const api = await requestApi();
      return { fills: await api.listStaticFormFills(new Uint8Array(await ctx.read(input.path))) };
    },
  };

  return { routes, requestApi };
}

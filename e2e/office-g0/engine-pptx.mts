// DOC-003 engine host: PPTX routes on the real pptx engine + op executor.
//
// openPptx/savePptx come from the prepared source''s @genoffice/pptx-engine. The
// op executor (runTxn) comes from the prebundle written by
// scripts/office-g0/prebundle-engine.mjs, because tsx cannot load the "?raw"
// markdown prompts inside @genoffice/pptx-ops. The prebundle marks
// @genoffice/pptx-engine external and rewrites that specifier to the source
// entry''s file URL, so the executor and this host share ONE engine instance:
// runTxn mutates the very OpenedPptx this host opened and will save.
//
// Every op payload follows the real registry: the op field is "op" (not
// "name"), target is {slide, el}, setText takes EditParagraph[] with "align",
// geometry is EMU {x,y,cx,cy}, and pixel inputs are converted with the same
// viewport scale the slides main process uses. A transaction must report
// applied with zero failures before anything is saved or returned as an edit.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { PptxEngineError } from "./engine-pptx-types.mts";
import type {
  OpenedPptxLike,
  PptxAddElementInput,
  PptxAddImageInput,
  PptxEditParagraph,
  PptxEditTransformInput,
  PptxElementLike,
  PptxEngine,
  PptxEngineDeps,
  PptxLayouts,
  PptxOp,
  PptxOpRecord,
  PptxReplacePictureInput,
  PptxRunTxn,
  PptxTxnResult,
} from "./engine-pptx-types.mts";

export * from "./engine-pptx-types.mts";

export const EMU_PER_PX_96 = 9525;

/** Plain text of an element, from the engine''s own parsed run model. */
export function elementText(element: PptxElementLike | undefined): string {
  const paragraphs = element?.text?.paragraphs ?? [];
  return paragraphs.map((p) => (p.runs ?? []).map((r) => r.text ?? "").join("")).join("\n");
}

/** A text-bearing element is a shape or a text element per the engine model. */
export function findTextElement(
  opened: OpenedPptxLike,
  slideIndex: number,
  elementId?: string,
): PptxElementLike | undefined {
  const slide = opened.deck.slides[slideIndex];
  if (!slide) return undefined;
  const candidates = slide.elements.filter((e) => e.type === "text" || e.type === "shape");
  if (elementId !== undefined) return candidates.find((e) => e.id === elementId);
  return candidates[0];
}

/** Pixel -> EMU at the deck''s current viewport scale (identical to slides-main). */
export function makePxToEmu(opened: OpenedPptxLike, fitWidthPx: number): (px: number) => number {
  const width = opened.deck.size?.cx;
  if (typeof width !== "number" || width <= 0) {
    throw new PptxEngineError("deck_size_missing", "opened deck has no slide size to scale from");
  }
  if (!Number.isFinite(fitWidthPx) || fitWidthPx <= 0) {
    throw new PptxEngineError("bad_fit_width", "fitWidthPx must be a positive number");
  }
  const baseWidthPx = width / EMU_PER_PX_96;
  const scale = fitWidthPx / baseWidthPx;
  return (px) => Math.round((px / scale) * EMU_PER_PX_96);
}

const requirePositive = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new PptxEngineError("bad_geometry", field + " must be a finite number >= 0");
  }
  return value;
};

const checkParagraphs = (paragraphs: PptxEditParagraph[]): void => {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    throw new PptxEngineError("empty_paragraphs", "setText needs at least one paragraph");
  }
  for (const paragraph of paragraphs) {
    if (!Array.isArray(paragraph.runs) || paragraph.runs.length === 0) {
      throw new PptxEngineError("bad_runs", "every paragraph needs at least one run");
    }
    if (paragraph.runs.some((run) => typeof run.text !== "string")) {
      throw new PptxEngineError("bad_runs", "every run needs string text");
    }
  }
};

export function createPptxEngine(deps: PptxEngineDeps): PptxEngine {
  /** One transaction: dry-run plan first, then exactly one live apply. Refuse on any plan or apply failure. */
  const txn = (opened: OpenedPptxLike, ops: PptxOp[]): PptxTxnResult => {
    if (ops.length === 0) {
      throw new PptxEngineError("empty_ops", "a transaction needs at least one op");
    }
    const dry = deps.loadTxn()(opened, { dryRun: true, ops });
    // Upstream runTxn (executor.ts:187) returns { applied: false, dryRun: true, plan } for a
    // clean plan; applied is true only after the live apply. Accept the plan when the call is
    // really a dry run and reports no failures; refuse non-dry-run replies and any failure.
    if (dry.dryRun !== true || (dry.failures?.length ?? 0) > 0) {
      throw new PptxEngineError(
        "dry_run_failed",
        "op dry run failed: " + JSON.stringify(dry.failures ?? dry.plan ?? []),
      );
    }
    const result = deps.loadTxn()(opened, { ops });
    if (!result.applied) throw new PptxEngineError("txn_not_applied", "runTxn reported applied=false");
    if ((result.failures?.length ?? 0) > 0) {
      throw new PptxEngineError("txn_failures", "runTxn reported failures: " + JSON.stringify(result.failures));
    }
    return result;
  };

  const createdIds = (records: PptxOpRecord[] | undefined): string[] =>
    (records ?? []).flatMap((record) => record.created ?? []);

  return {
    open: (bytes) => deps.openPptx(bytes),
    save: (opened) => deps.savePptx(opened),

    async renderSlides(opened, fitWidthPx) {
      // buildRenderSlide is an async dependency: await every model so callers get
      // resolved render structures (not Promise[] serialized as [{},{},...]).
      return Promise.all(opened.deck.slides.map((_, index) => deps.buildRenderSlide(opened, index, fitWidthPx)));
    },

    async editText({ opened, slideIndex, elementId, paragraphs, groupId }) {
      checkParagraphs(paragraphs);
      const target = findTextElement(opened, slideIndex, elementId);
      if (!target) {
        throw new PptxEngineError(
          "no_text_target",
          "slide " + slideIndex + " has no " + (elementId ? "element " + elementId : "text/shape element"),
        );
      }
      const result = txn(opened, [
        {
          op: "setText",
          target: { slide: slideIndex, el: target.id },
          paragraphs,
          ...(groupId === undefined ? {} : { group: groupId }),
        },
      ]);
      return {
        applied: true,
        failures: [],
        targetId: target.id,
        targetType: target.type,
        records: result.records ?? [],
      };
    },

    async editTransform(input: PptxEditTransformInput) {
      const { opened, slideIndex, elementId, groupId } = input;
      const toEmu = makePxToEmu(opened, input.fitWidthPx);
      const slide = opened.deck.slides[slideIndex];
      if (!slide) throw new PptxEngineError("no_slide", "no slide " + slideIndex);
      const element = slide.elements.find((el) => el.id === elementId);
      if (!element) throw new PptxEngineError("no_element", "no element " + elementId + " on slide " + slideIndex);
      txn(opened, [
        {
          op: "setTransform",
          target: { slide: slideIndex, el: elementId },
          box: {
            x: toEmu(requirePositive(input.xPx, "xPx")),
            y: toEmu(requirePositive(input.yPx, "yPx")),
            cx: Math.max(1, toEmu(requirePositive(input.wPx, "wPx"))),
            cy: Math.max(1, toEmu(requirePositive(input.hPx, "hPx"))),
          },
          rotDeg: input.rotationDeg,
          ...(groupId === undefined ? {} : { group: groupId }),
        },
      ]);
      return { applied: true, targetId: elementId, targetType: element.type };
    },

    async addElement(input: PptxAddElementInput) {
      const { opened, slideIndex } = input;
      if (!opened.deck.slides[slideIndex]) {
        throw new PptxEngineError("no_slide", "no slide " + slideIndex);
      }
      const toEmu = makePxToEmu(opened, input.fitWidthPx);
      const paragraphs = input.paragraphs ?? undefined;
      const result = txn(opened, [
        {
          op: "addElement",
          target: { slide: slideIndex },
          kind: input.kind,
          offset: {
            x: toEmu(requirePositive(input.xPx, "xPx")),
            y: toEmu(requirePositive(input.yPx, "yPx")),
            cx: Math.max(1, toEmu(requirePositive(input.wPx, "wPx"))),
            cy: Math.max(1, toEmu(requirePositive(input.hPx, "hPx"))),
          },
          ...(paragraphs ? { paragraphs } : {}),
          ...(input.fillColor ? { fill: input.fillColor } : {}),
          ...(input.stroke ? { stroke: input.stroke } : {}),
        },
      ]);
      const created = createdIds(result.records);
      if (created.length === 0) {
        throw new PptxEngineError("no_created_element", "addElement reported no created element id");
      }
      return { applied: true, createdId: created[0] as string };
    },

    async addImageBytes(input: PptxAddImageInput) {
      const { opened, slideIndex } = input;
      if (!opened.deck.slides[slideIndex]) {
        throw new PptxEngineError("no_slide", "no slide " + slideIndex);
      }
      const toEmu = makePxToEmu(opened, input.fitWidthPx);
      const result = txn(opened, [
        {
          op: "addPicture",
          target: { slide: slideIndex },
          bytes: Buffer.from(input.base64, "base64"),
          ext: input.ext,
          offset: {
            x: toEmu(requirePositive(input.xPx, "xPx")),
            y: toEmu(requirePositive(input.yPx, "yPx")),
            cx: Math.max(1, toEmu(requirePositive(input.wPx, "wPx"))),
            cy: Math.max(1, toEmu(requirePositive(input.hPx, "hPx"))),
          },
        },
      ]);
      const created = createdIds(result.records);
      if (created.length === 0) {
        throw new PptxEngineError("unsupported_image", "addPicture reported no created element");
      }
      return { applied: true, createdId: created[0] as string };
    },

    // Read-only layout catalog for the renderer's new-slide picker: the deck's own
    // slideLayouts plus the built-in standard set while the deck's own layouts carry no
    // placeholders. Mirrors the upstream slides main process (slides-main.ts:2556
    // `slides:get-layouts`), and listSlideLayouts only ever reads the archive, so this
    // route cannot mutate a deck.
    listLayouts(opened: OpenedPptxLike): Promise<PptxLayouts> {
      return deps.listLayouts(opened);
    },

    async replacePictureBytes(input: PptxReplacePictureInput) {
      const { opened, slideIndex, elementId } = input;
      txn(opened, [
        {
          op: "replacePicture",
          target: { slide: slideIndex, el: elementId },
          bytes: Buffer.from(input.base64, "base64"),
          ext: input.ext,
          ...(input.keepSrcRect === true ? { keepSrcRect: true } : {}),
        },
      ]);
      return { applied: true, targetId: elementId };
    },
  };
}

/** Load the engine pair + render layer from the prepared source tree. */
export async function loadPptxEngineFromSource(sourceRoot: string): Promise<{
  openPptx: (bytes: Uint8Array) => Promise<OpenedPptxLike>;
  savePptx: (opened: OpenedPptxLike) => Promise<Uint8Array>;
  buildRenderSlide: (opened: OpenedPptxLike, slideIndex: number, fitWidthPx: number) => Promise<unknown>;
  listLayouts: (opened: OpenedPptxLike) => Promise<PptxLayouts>;
}> {
  const engine = (await import(
    pathToFileURL(join(sourceRoot, "packages/pptx-engine/src/index.ts")).href
  )) as {
    openPptx: (bytes: Uint8Array) => Promise<OpenedPptxLike>;
    savePptx: (opened: OpenedPptxLike) => Promise<Uint8Array>;
    listSlideLayouts: (archive: unknown) => PptxLayouts["layouts"];
    shouldOfferBuiltinLayouts: (layouts: PptxLayouts["layouts"]) => boolean;
    builtinLayoutInfos: (size: { cx: number; cy: number }, existing: Set<string>) => PptxLayouts["layouts"];
  };
  // The render layer is plain data (no Node/canvas import): the heuristic metrics
  // provider is enough to prove that a text/image/shape edit reaches the model.
  const render = (await import(
    pathToFileURL(join(sourceRoot, "packages/pptx-render/src/index.ts")).href
  )) as {
    buildRenderSlide: (
      slide: unknown,
      size: unknown,
      opts: { fitWidthPx: number; media?: (ref: string) => string | undefined; slideNo?: number },
    ) => unknown;
  };
  const media = (opened: OpenedPptxLike) => (ref: string): string | undefined => {
    const archive = opened.archive as { readBytes?: (path: string) => Uint8Array | undefined } | undefined;
    const bytes = archive?.readBytes?.(ref);
    if (!bytes) return undefined;
    const ext = ref.slice(ref.lastIndexOf(".") + 1).toLowerCase();
    const mime =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "gif"
            ? "image/gif"
            : ext === "svg"
              ? "image/svg+xml"
              : "application/octet-stream";
    return "data:" + mime + ";base64," + Buffer.from(bytes).toString("base64");
  };
  return {
    openPptx: engine.openPptx,
    savePptx: engine.savePptx,
    // The real upstream catalog: the deck's slideLayouts, extended with the built-in
    // standard set only while the deck's own layouts carry no placeholders. Nothing is
    // injected here - insertion is the ops layer's job - so this is read-only, like upstream.
    listLayouts: async (opened: OpenedPptxLike): Promise<PptxLayouts> => {
      const layouts = engine.listSlideLayouts(opened.archive);
      if (engine.shouldOfferBuiltinLayouts(layouts)) {
        layouts.push(
          ...engine.builtinLayoutInfos(
            opened.deck.size as { cx: number; cy: number },
            new Set(layouts.map((layout) => layout.name)),
          ),
        );
      }
      return { layouts, size: { ...(opened.deck.size as { cx: number; cy: number }) } };
    },
    buildRenderSlide: async (opened, slideIndex, fitWidthPx) => {
      const slide = opened.deck.slides[slideIndex];
      if (!slide) throw new PptxEngineError("no_slide", "no slide " + slideIndex);
      return render.buildRenderSlide(slide, opened.deck.size, {
        fitWidthPx,
        media: media(opened),
        slideNo: slideIndex + 1,
      });
    },
  };
}

/** Import the prebundle written by scripts/office-g0/prebundle-engine.mjs. */
export async function loadPrebundle(prebundlePath: string): Promise<{
  loadTxn: () => PptxRunTxn;
  exports: string[];
  moduleId: string;
}> {
  const mod = (await import(pathToFileURL(prebundlePath).href)) as Record<string, unknown>;
  const runTxn = mod.runTxn;
  if (typeof runTxn !== "function") {
    throw new PptxEngineError("prebundle_invalid", "prebundle has no runTxn export: " + prebundlePath);
  }
  const txn = runTxn as PptxRunTxn;
  return { loadTxn: () => txn, exports: Object.keys(mod).sort(), moduleId: prebundlePath };
}

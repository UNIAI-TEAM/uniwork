// PPTX vendored-engine binding — maps the packages/office-upstream build
// artifacts onto this lane's seam. As with the docx binding, module objects
// arrive already imported; this file itself never touches Node/fs/canvas.
//
// Upstream surface bound here (pinned 09485f88):
//   dist/pptx-engine.mjs -> openPptx / reparseDeck / savePptx / commitSaved /
//                          listSlideLayouts / builtinLayoutInfos
//   dist/pptx-ops.mjs    -> runTxn (ops self-register on bundle import)
//   dist/pptx-render.mjs -> buildRenderSlide + HeuristicMetrics (no canvas —
//                          the heuristic metrics path is the honest fallback)
import { PptxEngineError } from "./engine";
import type {
  OpenedPptxLike,
  PptxEngineFunctions,
  PptxMasterPartLike,
  PptxOpsFunctions,
  PptxRenderPort,
  PptxRunTxn,
} from "./engine";

/** The pptx-engine bundle's export surface (subset this seam consumes). */
export interface UpstreamPptxEngineModule {
  openPptx(bytes: Uint8Array): Promise<OpenedPptxLike>;
  savePptx(opened: OpenedPptxLike): Promise<Uint8Array>;
  commitSaved(opened: OpenedPptxLike): void;
  reparseDeck?(opened: OpenedPptxLike): OpenedPptxLike;
  listSlideLayouts?(archive: unknown): Array<{ name: string; path: string }>;
  shouldOfferBuiltinLayouts?(layouts: Array<{ name: string; path: string }>): boolean;
  builtinLayoutInfos?(size: { cx: number; cy: number }, existing: Set<string>): Array<{ name: string; path: string }>;
  getSlideNotes?(archive: unknown, slidePath: string): string;
  parseMasterPart?(archive: unknown, partPath: string): PptxMasterPartLike | null;
}

/** The pptx-ops bundle (executor.ts:160); ops self-register at import. */
export interface UpstreamPptxOpsModule {
  runTxn: PptxRunTxn;
}

/** The pptx-render bundle's render + metrics surface (build-slide.ts:129,
 * metrics.ts HeuristicMetrics). */
export interface UpstreamPptxRenderModule {
  buildRenderSlide(
    slide: unknown,
    size: { cx: number; cy: number } | undefined,
    opts: { fitWidthPx?: number; metrics?: unknown; media?: unknown; slideNo?: number },
  ): Record<string, unknown>;
  HeuristicMetrics: new () => unknown;
}

export function bindPptxEngine(mod: UpstreamPptxEngineModule): PptxEngineFunctions {
  return {
    openPptx: (bytes: Uint8Array) => mod.openPptx(bytes),
    savePptx: (opened: OpenedPptxLike) => mod.savePptx(opened),
    commitSaved: (opened: OpenedPptxLike) => mod.commitSaved(opened),
    ...(mod.reparseDeck ? { reparseDeck: (opened: OpenedPptxLike) => mod.reparseDeck!(opened) } : {}),
    ...(mod.listSlideLayouts ? { listSlideLayouts: (a: unknown) => mod.listSlideLayouts!(a) } : {}),
    ...(mod.shouldOfferBuiltinLayouts
      ? { shouldOfferBuiltinLayouts: (l: Array<{ name: string; path: string }>) => mod.shouldOfferBuiltinLayouts!(l) }
      : {}),
    ...(mod.builtinLayoutInfos
      ? { builtinLayoutInfos: (s: { cx: number; cy: number }, e: Set<string>) => mod.builtinLayoutInfos!(s, e) }
      : {}),
    ...(mod.getSlideNotes ? { getSlideNotes: (a: unknown, p: string) => mod.getSlideNotes!(a, p) } : {}),
    ...(mod.parseMasterPart ? { parseMasterPart: (a: unknown, p: string) => mod.parseMasterPart!(a, p) } : {}),
  };
}

export function bindPptxOps(mod: UpstreamPptxOpsModule): PptxOpsFunctions {
  return { runTxn: (opened, req) => mod.runTxn(opened, req) };
}

/** Render port over buildRenderSlide: slide + deck size + fitWidth viewport;
 * HeuristicMetrics is the upstream no-canvas text metrics path, so the port
 * works wherever the bundle loads — the unbound refusal stays for hosts that
 * never wire it. */
export function bindPptxRender(mod: UpstreamPptxRenderModule): PptxRenderPort {
  return {
    async buildRenderSlide(opened: OpenedPptxLike, slideIndex: number, fitWidthPx: number) {
      const slide = opened.deck.slides[slideIndex];
      if (!slide) throw new PptxEngineError("no_slide", "no slide " + slideIndex + " in opened deck");
      return mod.buildRenderSlide(slide, opened.deck.size, {
        fitWidthPx,
        metrics: new mod.HeuristicMetrics(),
      });
    },
  };
}

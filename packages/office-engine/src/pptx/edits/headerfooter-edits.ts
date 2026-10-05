// B7e (UNI-927) - header/footer + insert-slide-from-another-pptx edits (logic half).
//
// Binds the two vendored pptx-ops kinds this area owns to one typed, validated
// op builder. The wire round registers `HeaderFooterEdit` as `PptxEdit` kinds
// in model.ts and calls the builder mechanically:
//
//   this.txn(buildHeaderFooterOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY - never imported; cited for every field):
//   applyHeaderFooter  packages/pptx-ops/src/ops/slide-ops.ts:605 (validate
//                      606-610: settings must be an object; apply 611-616 ->
//                      pptx-engine applyHeaderFooter, deck-level, no target).
//                      Settings shape: pptx-engine/src/headerfooter.ts:15-24
//                      (HeaderFooterOptions):
//                        footer?:   string | null   (null/'' = no footer)
//                        slideNum?: boolean         (show the slide number)
//                        date?:     string | null   (fixed date text)
//                        dateAuto?: boolean         (dynamic datetime field)
//                      applyHeaderFooter writes dt/ftr/sldNum placeholders into
//                      each slide (headerfooter.ts:58-152, all slides by default).
//   insertSlidePptx    packages/pptx-ops/src/ops/slide-ops.ts:228 (validate
//                      229-256; apply 258-276 -> mergeSlideFromSource +
//                      promoteSlideBackground + moveSlide/deleteSlide). Fields:
//                        source: { slideXml: string; rels: unknown[];
//                                  media: unknown[]; layoutChain: unknown[] }
//                        at?:     number  (0..slideCount, integer; the append
//                                 slot slideCount is valid)
//                        replace?: boolean (requires at pointing at an existing
//                                 slide, i.e. at < slideCount)
//                      apply returns { created: [slideId], after: { index } }.
//                      Source shape: pptx-engine/src/index.ts:2001-2009
//                      (MergeSlideSource; extractMergeSlideSource :2012).
//
// Both kinds are geometry-free - header/footer placeholders are positioned by
// the engine from the deck size, and insertSlidePptx carries no rect - so no
// px->EMU conversion happens here. `fitWidthPx` stays in the signature only
// because every engine-half builder shares the same mechanical wire call.
//
// The `source` payload is MAIN-PROCESS data (extractMergeSlideSource output);
// this builder validates its shape and passes the arrays through untouched,
// never reading or rewriting them. Extra keys (e.g. srcSlidePath) ride along
// as-is for the merge.
import { PptxEngineError, type OpenedPptxLike, type PptxOp } from "../engine";

/** Header/footer settings, mirroring the vendored HeaderFooterOptions
 * (pptx-engine/src/headerfooter.ts:15-24) one-for-one. */
export interface PptxHeaderFooterSettings {
  /** Footer text; null/undefined/"" = no footer. */
  footer?: string | null;
  /** Show the slide number placeholder. */
  slideNum?: boolean;
  /** Fixed date text; null/"" = hidden. */
  date?: string | null;
  /** Write a dynamic datetime field (auto-updates in PowerPoint). */
  dateAuto?: boolean;
}

/** The extracted single-slide pptx source the merge consumes
 * (MergeSlideSource, pptx-engine/src/index.ts:2001-2009). The four fields the
 * vendored validate checks are required; any extra key (e.g. srcSlidePath, the
 * base for resolving media targets) passes through untouched. */
export interface PptxInsertSource {
  /** The source slide part XML. */
  slideXml: string;
  /** Source relationships (Relationship[]; may be empty). */
  rels: unknown[];
  /** Referenced media bytes keyed by resolved source path (may be empty). */
  media: unknown[];
  /** Source layout->master->theme chain (may be empty). */
  layoutChain: unknown[];
  [key: string]: unknown;
}

/** The edit kinds this module builds (registered as PptxEdit kinds by the
 * wire round):
 *  - apply_header_footer -> vendored `applyHeaderFooter` (deck-level, no
 *                           slide target; settings carries the toggles);
 *  - insert_slide_pptx   -> vendored `insertSlidePptx` (lands one extracted
 *                           single-slide source; optional at / replace). */
export type HeaderFooterEdit =
  | { op: "apply_header_footer"; settings: PptxHeaderFooterSettings }
  | { op: "insert_slide_pptx"; source: PptxInsertSource; at?: number; replace?: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Settings must be a plain object; every present field must match the
 * vendored HeaderFooterOptions type (a deliberate tightening over the vendored
 * validate, which only checks object-ness - see slide-ops.ts:606-610). */
function checkHfSettings(settings: unknown): PptxHeaderFooterSettings {
  if (!isRecord(settings)) {
    throw new PptxEngineError("bad_hf_settings", "apply_header_footer needs a settings object");
  }
  const { footer, slideNum, date, dateAuto } = settings;
  if (footer !== undefined && footer !== null && typeof footer !== "string") {
    throw new PptxEngineError("bad_hf_settings", '"footer" must be a string or null');
  }
  if (date !== undefined && date !== null && typeof date !== "string") {
    throw new PptxEngineError("bad_hf_settings", '"date" must be a string or null');
  }
  if (slideNum !== undefined && typeof slideNum !== "boolean") {
    throw new PptxEngineError("bad_hf_settings", '"slideNum" must be a boolean');
  }
  if (dateAuto !== undefined && typeof dateAuto !== "boolean") {
    throw new PptxEngineError("bad_hf_settings", '"dateAuto" must be a boolean');
  }
  return settings as PptxHeaderFooterSettings;
}

/** Source must be a non-null object with a string slideXml and the three
 * arrays the merge dereferences without guards (slide-ops.ts:234-246). */
function checkInsertSource(source: unknown): PptxInsertSource {
  if (!isRecord(source) || typeof source.slideXml !== "string") {
    throw new PptxEngineError(
      "bad_insert_source",
      "insert_slide_pptx needs a source object with a string slideXml",
    );
  }
  for (const field of ["rels", "media", "layoutChain"] as const) {
    if (!Array.isArray(source[field])) {
      throw new PptxEngineError("bad_insert_source", '"source.' + field + '" must be an array');
    }
  }
  return source as unknown as PptxInsertSource;
}

/** One validated edit -> the vendored pptx-ops op the executor runs. Refusals
 * are typed PptxEngineError codes: bad_hf_settings (settings not a plain
 * object / field type mismatch), bad_insert_source (source shape),
 * bad_insert_at (at neither an integer in 0..slideCount nor absent),
 * bad_insert_replace (replace without a valid existing-slide at). */
export function buildHeaderFooterOps(
  opened: OpenedPptxLike,
  fitWidthPx: number,
  edit: HeaderFooterEdit,
): PptxOp[] {
  // Deck-size-driven placeholder geometry lives in the engine; nothing here
  // converts px. `void` keeps the uniform wire signature honest.
  void fitWidthPx;
  const slideCount = opened.deck.slides.length;
  switch (edit.op) {
    case "apply_header_footer":
      // Deck-level op: no target (slide-ops.ts:605-616). Settings ride through
      // by reference, untouched.
      return [{ op: "applyHeaderFooter", settings: checkHfSettings(edit.settings) }];
    case "insert_slide_pptx": {
      const source = checkInsertSource(edit.source);
      const { at, replace } = edit;
      if (at !== undefined) {
        if (typeof at !== "number" || !Number.isInteger(at) || at < 0 || at > slideCount) {
          throw new PptxEngineError(
            "bad_insert_at",
            'insert_slide_pptx "at" must be an integer in 0..' + String(slideCount),
          );
        }
      }
      if (replace !== undefined && typeof replace !== "boolean") {
        throw new PptxEngineError("bad_insert_replace", '"replace" must be a boolean');
      }
      // replace replaces the page at `at`, so it needs at pointing at an
      // existing slide (slide-ops.ts:252-256).
      if (replace === true && (typeof at !== "number" || at >= slideCount)) {
        throw new PptxEngineError(
          "bad_insert_replace",
          'insert_slide_pptx "replace" needs "at" pointing at an existing slide (0..' +
            String(slideCount - 1) +
            ")",
        );
      }
      return [
        {
          op: "insertSlidePptx",
          source,
          ...(at === undefined ? {} : { at }),
          ...(replace === undefined ? {} : { replace }),
        },
      ];
    }
    default: {
      const unknown = edit as { op?: unknown };
      throw new PptxEngineError(
        "bad_hf_op",
        "unsupported header/footer edit " + String(unknown.op),
      );
    }
  }
}
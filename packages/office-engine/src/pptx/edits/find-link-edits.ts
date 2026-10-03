// A6e (UNI-927) — find & replace + hyperlink edits (logic half).
//
// Binds the two vendored pptx-ops kinds this area owns to one typed,
// validated op builder. The wire round registers `FindLinkEdit` as `PptxEdit`
// kinds in model.ts and calls the builder mechanically:
//
//   this.txn(buildFindLinkOps(this.opened, this.fitWidthPx, edit))
//
// Vendored contract (READ ONLY — never imported; cited for every field):
//   findReplace  packages/pptx-ops/src/ops/slide-ops.ts:583 (validate: 584-589,
//                apply: 590-601 -> replaceAllInDeck)
//                packages/pptx-engine/src/index.ts:3031 (replaceAllInDeck
//                semantics: within one run, literal, global, ci unless matchCase)
//   setLink      packages/pptx-ops/src/ops/element-ops.ts:558 (validate calls
//                requireLinkTarget + resolveElement; apply: 563-571)
//                link guard: packages/pptx-ops/src/ops/registry.ts:352-370
//                named actions: packages/pptx-engine/src/named-action.ts:4-11
//
// Both kinds are geometry-free — findReplace edits run text deck-wide and
// setLink carries a link target, never a rect — so no px→EMU conversion
// happens here; `fitWidthPx` stays in the signature only because every
// engine-half builder shares the same mechanical wire call.
import { PptxEngineError, type OpenedPptxLike, type PptxOp, type PptxSlideLike } from "../engine";

/** Named show actions the engine accepts (named-action.ts:4-11). */
export const PPTX_NAMED_ACTIONS = [
  "nextslide",
  "previousslide",
  "firstslide",
  "lastslide",
  "lastslideviewed",
  "endshow",
] as const;
export type PptxNamedAction = (typeof PPTX_NAMED_ACTIONS)[number];

/** A hyperlink target — url / jump to slide / named show action, or null to
 * remove. Shape pinned to registry.ts:352-370 (`requireLinkTarget`): a url
 * must be a non-empty string, a slide index a non-negative integer, an action
 * one of PPTX_NAMED_ACTIONS. */
export type PptxLinkTarget =
  | { kind: "url"; url: string }
  | { kind: "slide"; slideIndex: number }
  | { kind: "action"; action: PptxNamedAction }
  | null;

/** The edit kinds this module builds (registered as PptxEdit kinds by the
 * wire round):
 *  - find_replace -> vendored `findReplace` (deck-level, no target);
 *  - set_link     -> vendored `setLink` (element target + link). */
export type FindLinkEdit =
  | {
      op: "find_replace";
      find: string;
      replace: string;
      /** Case-sensitive match when true (default false — vendored 'gi'). */
      matchCase?: boolean;
      /** Replace only the first match deck-wide (the "Replace" button). */
      firstOnly?: boolean;
      /** Restrict to one slide; must exist when present. */
      slideIndex?: number;
      /** Restrict to one element id (optional, combined with slideIndex). */
      elementId?: string;
    }
  | { op: "set_link"; slideIndex: number; elementId: string; link: PptxLinkTarget };

// ── pure find/replace planning (the Find dialog's match counts) ────────────

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Non-overlapping occurrence count across the given texts. Mirrors
 * `replaceAllInDeck` (pptx-engine index.ts:3038): the find term is a literal
 * (regex metacharacters escaped), matched globally, case-insensitively unless
 * `matchCase`. An empty find term counts nothing — the same early return the
 * vendored function makes. Pass the texts at the match unit the op edits
 * (one run per entry): the engine replaces within a single run, so counts
 * over joined paragraphs may exceed what the op would replace. */
export function countFindMatches(deckTexts: readonly string[], find: string, matchCase?: boolean): number {
  if (!find) return 0;
  const re = new RegExp(escapeRegExp(find), matchCase ? "g" : "gi");
  let total = 0;
  for (const text of deckTexts) {
    const matches = text.match(re);
    if (matches) total += matches.length;
  }
  return total;
}

/** What running find_replace over the given texts would do — pure, no deck
 * model. `total` is what the dialog counts; `replaceCount` is what the op
 * would replace (firstOnly caps it at 1); `hits` lists the inputs that match,
 * in scan order, so the dialog can select/highlight them. */
export interface FindReplacePlan {
  total: number;
  replaceCount: number;
  hits: ReadonlyArray<{ index: number; count: number }>;
}

export function planFindReplace(
  deckTexts: readonly string[],
  find: string,
  options: { matchCase?: boolean; firstOnly?: boolean } = {},
): FindReplacePlan {
  const hits: Array<{ index: number; count: number }> = [];
  let total = 0;
  deckTexts.forEach((text, index) => {
    const count = countFindMatches([text], find, options.matchCase);
    if (count > 0) {
      hits.push({ index, count });
      total += count;
    }
  });
  return { total, replaceCount: options.firstOnly === true && total > 0 ? 1 : total, hits };
}

// ── validation + op building ───────────────────────────────────────────────

const requireSlide = (opened: OpenedPptxLike, slideIndex: number, op: string): PptxSlideLike => {
  const slide = Number.isInteger(slideIndex) && slideIndex >= 0 ? opened.deck.slides[slideIndex] : undefined;
  if (!slide) {
    throw new PptxEngineError("no_slide", op + ": slide index " + String(slideIndex) + " does not exist");
  }
  return slide;
};

const requireOptionalSlide = (opened: OpenedPptxLike, slideIndex: number | undefined, op: string): void => {
  if (slideIndex === undefined) return;
  requireSlide(opened, slideIndex, op);
};

const requireLinkTarget = (link: PptxLinkTarget): void => {
  // null removes the link — registry.ts:353 returns before any shape check.
  if (link === null) return;
  const usage =
    'set_link "link" must be {kind:"url",url} (non-empty url), {kind:"slide",slideIndex} (integer >= 0), ' +
    '{kind:"action",action} (one of ' +
    PPTX_NAMED_ACTIONS.join(", ") +
    ") or null to remove.";
  const target = link as { kind?: unknown; url?: unknown; slideIndex?: unknown; action?: unknown } | null | undefined;
  if (!target || typeof target !== "object") {
    throw new PptxEngineError("bad_link", usage);
  }
  if (target.kind === "url") {
    if (typeof target.url !== "string" || target.url.length === 0) {
      throw new PptxEngineError("bad_link", usage);
    }
    return;
  }
  if (target.kind === "slide") {
    if (!Number.isInteger(target.slideIndex) || (target.slideIndex as number) < 0) {
      throw new PptxEngineError("bad_link", usage);
    }
    return;
  }
  if (target.kind === "action") {
    if (!(PPTX_NAMED_ACTIONS as readonly unknown[]).includes(target.action)) {
      throw new PptxEngineError(
        "bad_link",
        'set_link "link.action" must be one of ' + PPTX_NAMED_ACTIONS.join(", ") + ".",
      );
    }
    return;
  }
  throw new PptxEngineError("bad_link", usage);
};

/** One validated edit -> the vendored op(s) the executor runs. Refusals are
 * typed PptxEngineError codes: bad_find / bad_replace (find_replace fields),
 * no_slide (slide index present but absent from the deck), no_element
 * (set_link target element missing), bad_link (link shape). */
export function buildFindLinkOps(opened: OpenedPptxLike, fitWidthPx: number, edit: FindLinkEdit): PptxOp[] {
  // Geometry-free kinds: nothing to convert (see the module header). `void`
  // keeps the uniform wire signature honest about the deliberate non-use.
  void fitWidthPx;
  switch (edit.op) {
    case "find_replace": {
      if (typeof edit.find !== "string" || edit.find.length === 0) {
        throw new PptxEngineError("bad_find", 'find_replace "find" must be a non-empty string');
      }
      if (typeof edit.replace !== "string") {
        throw new PptxEngineError("bad_replace", 'find_replace "replace" must be a string');
      }
      requireOptionalSlide(opened, edit.slideIndex, "find_replace");
      return [
        {
          op: "findReplace",
          find: edit.find,
          replace: edit.replace,
          ...(edit.matchCase === undefined ? {} : { matchCase: edit.matchCase }),
          ...(edit.firstOnly === undefined ? {} : { firstOnly: edit.firstOnly }),
          ...(edit.slideIndex === undefined ? {} : { slideIndex: edit.slideIndex }),
          ...(edit.elementId === undefined ? {} : { elementId: edit.elementId }),
        },
      ];
    }
    case "set_link": {
      const slide = requireSlide(opened, edit.slideIndex, "set_link");
      const element = slide.elements.find((candidate) => candidate.id === edit.elementId);
      if (!element) {
        throw new PptxEngineError(
          "no_element",
          'set_link: no element "' + edit.elementId + '" on slide ' + String(edit.slideIndex),
        );
      }
      requireLinkTarget(edit.link);
      return [{ op: "setLink", target: { slide: edit.slideIndex, el: edit.elementId }, link: edit.link }];
    }
  }
}

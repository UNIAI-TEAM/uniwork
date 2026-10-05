// UNI-927 X1 (R2-1, R2-2) - read the transition, the auto-advance time and the
// animation list of a parsed slide, the way the vendored engine writes them.
//
// The real slide model carries none of the three as a field: setTransition /
// setAdvanceTime patch `<p:transition>` and addAnimation & co. patch
// `<p:timing>` inside the slide's `bodySuffix`. The vendored readers
// (pptx-engine/src/generate.ts readSlideTransitionXml:1540,
// readSlideAdvanceTimeXml:1587; animation.ts readSlideTimingXml:730) are not
// part of the generated browser artifact, so this is a browser-safe port of
// them, reading the same bytes the save writes. Order of the animation list is
// the vendored timeline order, which is what remove/reorder `seq` index.
import type { PptxAnimEffect, PptxAnimTrigger } from "./edits/animation-edits";
import type { PptxTransitionKind } from "./edits/transition-edits";

/** The slide's transition and its auto-advance time (ms; null = no timer). */
export interface PptxSlideTransitionRead {
  kind: PptxTransitionKind;
  advanceMs: number | null;
}

/** One effect of the slide's main sequence, in play order. */
export interface PptxSlideAnimationRead {
  /** The target shape's `<p:cNvPr id>` (`<p:spTgt spid>`). */
  spid: number;
  /** The live element whose cNvPr id is `spid`; null when none matches. */
  elementId: string | null;
  effect: PptxAnimEffect;
  trigger: PptxAnimTrigger;
  durationMs: number;
  delayMs: number;
}

interface SlideXmlLike {
  bodySuffix?: unknown;
  elements?: ReadonlyArray<{ id?: unknown; anchor?: { originalXml?: unknown } }>;
}

const TRANSITION_RE = /<p:transition\b[^>]*\/>|<p:transition\b[^>]*>[\s\S]*?<\/p:transition>/;
const AC_TRANSITION_RE = /<mc:AlternateContent\b[^>]*>\s*<mc:Choice\b[^>]*>\s*<p:transition\b[\s\S]*?<\/mc:AlternateContent>/;
const TIMING_RE = /<p:timing\b[^>]*\/>|<p:timing\b[^>]*>[\s\S]*?<\/p:timing>/;

const suffixOf = (slide: SlideXmlLike | undefined): string => (typeof slide?.bodySuffix === "string" ? slide.bodySuffix : "");

/** @public - transition + advance time of a live slide (readSlideTransitionXml / readSlideAdvanceTimeXml). */
export function readPptxSlideTransition(slide: SlideXmlLike | undefined): PptxSlideTransitionRead {
  const block = (AC_TRANSITION_RE.exec(suffixOf(slide)) ?? TRANSITION_RE.exec(suffixOf(slide)))?.[0];
  if (!block) return { kind: "none", advanceMs: null };
  const advance = /\badvTm="(\d+)"/.exec(block);
  const advanceMs = advance ? Number(advance[1]) : null;
  if (/<[\w.]+:morph[\s/>]/.test(block)) return { kind: "morph", advanceMs };
  const kind = /<p:(fade|push|wipe|split|circle|cover|pull|dissolve|zoom|random)\b/.exec(block)?.[1];
  return { kind: (kind as PptxTransitionKind | undefined) ?? "none", advanceMs };
}

/** Balanced scan from the end of a `<p:cTn>` open tag to its matching close. */
function cTnEnd(xml: string, openEnd: number): number {
  const re = /<p:cTn\b[^>]*?(\/?)>|<\/p:cTn>/g;
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    if (m[0] === "</p:cTn>") {
      depth -= 1;
      if (depth === 0) return m.index;
    } else if (m[1] !== "/") {
      depth += 1;
    }
  }
  return xml.length;
}

// presetClass:presetID(:presetSubtype) -> effect (animation.ts modeledEffect).
const BY_SUBTYPE: Record<string, PptxAnimEffect> = { "entr:22:1": "wipe", "entr:22:4": "wipeDown" };
const BY_PRESET: Record<string, PptxAnimEffect> = {
  "entr:1": "appear", "entr:10": "fade", "entr:2": "flyIn", "entr:22": "wipe", "entr:16": "splitIn",
  "entr:26": "bounce", "entr:30": "flipIn", "entr:23": "zoom", "emph:26": "pulse", "emph:8": "spin",
  "emph:6": "grow", "emph:32": "teeter", "exit:1": "disappear", "exit:10": "fadeOut", "exit:2": "flyOut",
  "exit:22": "wipeOut", "exit:30": "shrink", "exit:23": "zoomOut",
};

/** animation.ts effectFromPreset: an unmodeled preset reads as its class's closest kind. */
function effectOf(cls: string, id: number, sub: number): PptxAnimEffect {
  if (cls === "path") return "motionPath";
  const hit = BY_SUBTYPE[`${cls}:${id}:${sub}`] ?? BY_PRESET[`${cls}:${id}`];
  if (hit) return hit;
  return cls === "exit" ? "fadeOut" : cls === "emph" ? "pulse" : "fade";
}

/** The element's own cNvPr id (animation.ts elementSpid). */
function spidOf(element: { anchor?: { originalXml?: unknown } }): number | null {
  const xml = element.anchor?.originalXml;
  const m = typeof xml === "string" ? /<p:cNvPr\s[^>]*\bid="(\d+)"/.exec(xml) : null;
  return m ? Number(m[1]) : null;
}

/** @public - the main-sequence animation list of a live slide (readSlideTimingXml). */
export function readPptxSlideAnimations(slide: SlideXmlLike | undefined): PptxSlideAnimationRead[] {
  const timing = TIMING_RE.exec(suffixOf(slide))?.[0];
  const seqOpen = timing ? /<p:cTn\b[^>]*\bnodeType="mainSeq"[^>]*>/.exec(timing) : null;
  if (!timing || !seqOpen) return [];
  const seqStart = seqOpen.index + seqOpen[0].length;
  const seqEnd = cTnEnd(timing, seqStart);
  const byspid = new Map<number, string>();
  for (const element of slide?.elements ?? []) {
    const spid = spidOf(element);
    if (spid !== null && typeof element.id === "string" && !byspid.has(spid)) byspid.set(spid, element.id);
  }
  const out: PptxSlideAnimationRead[] = [];
  const re = /<p:cTn\b([^>]*\bpresetClass="[^"]*"[^>]*)>/g;
  re.lastIndex = seqStart;
  let prevStart = 0;
  let prevEnd = 0;
  for (let m = re.exec(timing); m !== null && m.index < seqEnd; m = re.exec(timing)) {
    const attrs = m[1]!;
    const cls = /\bpresetClass="([^"]*)"/.exec(attrs)?.[1] ?? "entr";
    const id = Number(/\bpresetID="(\d+)"/.exec(attrs)?.[1] ?? "0");
    const sub = Number(/\bpresetSubtype="(\d+)"/.exec(attrs)?.[1] ?? "0");
    const nodeType = /\bnodeType="([^"]*)"/.exec(attrs)?.[1] ?? "clickEffect";
    const trigger: PptxAnimTrigger = nodeType === "withEffect" ? "withPrev" : nodeType === "afterEffect" ? "afterPrev" : "onClick";
    const bodyEnd = cTnEnd(timing, re.lastIndex);
    const body = timing.slice(re.lastIndex, bodyEnd);
    re.lastIndex = bodyEnd;
    const spidMatch = /<p:spTgt\s[^>]*\bspid="(\d+)"/.exec(body);
    if (!spidMatch) continue;
    const spid = Number(spidMatch[1]);
    const startMs = Number(/^\s*<p:stCondLst><p:cond delay="(\d+)"/.exec(body)?.[1] ?? "0");
    let durationMs = 0;
    for (const dur of body.matchAll(/\bdur="(\d+)"/g)) durationMs = Math.max(durationMs, Number(dur[1]));
    if (/\bautoRev="1"/.test(body)) durationMs *= 2;
    const effect = effectOf(cls, id, sub);
    if (effect === "appear" || effect === "disappear") durationMs = 0;
    // The write convention: "with" counts from the previous start, "after" from its end.
    if (trigger === "onClick") {
      prevStart = 0;
      prevEnd = 0;
    }
    const base = trigger === "afterPrev" ? prevEnd : trigger === "withPrev" ? prevStart : 0;
    const delayMs = Math.max(0, startMs - base);
    prevStart = startMs;
    prevEnd = startMs + Math.max(1, durationMs);
    out.push({ spid, elementId: byspid.get(spid) ?? null, effect, trigger, durationMs, delayMs });
  }
  return out;
}

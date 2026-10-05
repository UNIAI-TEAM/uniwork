// B4e (UNI-927) — transition + advance-timing edit-builder tests.
//
// Vendored guard first: every op these builders can emit must exist in
// slide-ops.ts as `name: '<op>'`, and the exported kind list must equal the
// vendored TRANSITION_KINDS (and the SlideTransitionKind union). Op objects
// are compared strictly (absent optionals stay absent) and refusals branch on
// typed PptxEngineError codes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTransitionOps,
  PPTX_TRANSITION_KINDS,
  PptxEngineError,
  type OpenedPptxLike,
  type TransitionEdit,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides — enough for slide-exists validation. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { id: "s1", elements: [] },
      { id: "s2", elements: [] },
    ],
  },
};

const build = (edit: TransitionEdit) => buildTransitionOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("transition vendored guard", () => {
  it("emits only op names registered in the vendored slide-ops source", () => {
    const slideOps = readVendored("pptx-ops/src/ops/slide-ops.ts");
    // The exact registry entries B4e binds to (slide-ops.ts:473 and :491).
    for (const op of ["setTransition", "setAdvanceTime"]) {
      expect(slideOps).toContain("name: '" + op + "'");
    }
  });

  it("pins PPTX_TRANSITION_KINDS to the vendored TRANSITION_KINDS array", () => {
    const source = readVendored("pptx-engine/src/generate.ts");
    const body = source.match(/TRANSITION_KINDS = \[([\s\S]*?)\]\s+as const/)?.[1] ?? "";
    const vendored = Array.from(body.matchAll(/'([a-z]+)'/g), (match) => match[1]);
    expect(vendored).toEqual([...PPTX_TRANSITION_KINDS]);
  });

  it("pins the kind list to the vendored SlideTransitionKind union too", () => {
    const source = readVendored("pptx-engine/src/generate.ts");
    const body = source.match(/export type SlideTransitionKind =([\s\S]*?)\n\n/)?.[1] ?? "";
    const union = Array.from(body.matchAll(/'([a-z]+)'/g), (match) => match[1]);
    expect(union).toEqual([...PPTX_TRANSITION_KINDS]);
  });
});

describe("set_transition op building", () => {
  it("builds the exact setTransition op for a mapped kind", () => {
    expect(build({ op: "set_transition", slideIndex: 1, kind: "fade" })).toStrictEqual([
      { op: "setTransition", target: { slide: 1 }, kind: "fade" },
    ]);
  });

  it("emits morph and none too (none clears on apply)", () => {
    expect(build({ op: "set_transition", slideIndex: 0, kind: "morph" })[0]).toStrictEqual({
      op: "setTransition",
      target: { slide: 0 },
      kind: "morph",
    });
    expect(build({ op: "set_transition", slideIndex: 0, kind: "none" })[0]).toStrictEqual({
      op: "setTransition",
      target: { slide: 0 },
      kind: "none",
    });
  });
});

describe("set_advance_time op building", () => {
  it("builds the exact setAdvanceTime op for a millisecond value", () => {
    expect(build({ op: "set_advance_time", slideIndex: 1, ms: 5000 })).toStrictEqual([
      { op: "setAdvanceTime", target: { slide: 1 }, ms: 5000 },
    ]);
  });

  it("keeps the raw ms, including 0 and fractions — the engine rounds on apply", () => {
    expect(build({ op: "set_advance_time", slideIndex: 0, ms: 0 })[0]).toStrictEqual({
      op: "setAdvanceTime",
      target: { slide: 0 },
      ms: 0,
    });
    expect(build({ op: "set_advance_time", slideIndex: 0, ms: 1500.5 })[0]).toStrictEqual({
      op: "setAdvanceTime",
      target: { slide: 0 },
      ms: 1500.5,
    });
  });

  it("emits null to clear the auto-advance timer", () => {
    expect(build({ op: "set_advance_time", slideIndex: 0, ms: null })).toStrictEqual([
      { op: "setAdvanceTime", target: { slide: 0 }, ms: null },
    ]);
  });
});

describe("transition/timing refusals", () => {
  it("refuses a missing slide with no_slide", () => {
    expect(errCode(() => build({ op: "set_transition", slideIndex: 9, kind: "fade" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_transition", slideIndex: -1, kind: "fade" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_transition", slideIndex: 0.5, kind: "fade" }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_advance_time", slideIndex: 9, ms: 100 }))).toBe("no_slide");
    expect(errCode(() => build({ op: "set_advance_time", slideIndex: -1, ms: null }))).toBe("no_slide");
  });

  it("refuses an unknown transition kind with bad_transition_kind", () => {
    const kindEdit = (kind: unknown): TransitionEdit =>
      ({ op: "set_transition", slideIndex: 0, kind }) as TransitionEdit;
    for (const kind of ["fly", "cut", "fade-in", "", undefined, null, 7]) {
      expect(errCode(() => build(kindEdit(kind)))).toBe("bad_transition_kind");
    }
  });

  it("refuses invalid advance times with bad_advance_time", () => {
    const msEdit = (ms: unknown): TransitionEdit =>
      ({ op: "set_advance_time", slideIndex: 0, ms }) as TransitionEdit;
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY, undefined, "5000", true]) {
      expect(errCode(() => build(msEdit(ms)))).toBe("bad_advance_time");
    }
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build({ op: "set_transition", slideIndex: 0, kind: "fly" } as unknown as TransitionEdit);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("bad_transition_kind");
  });
});

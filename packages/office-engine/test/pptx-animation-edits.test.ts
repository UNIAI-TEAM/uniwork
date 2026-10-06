// B5e (UNI-927) - animation edit-builder tests.
//
// Vendored guard first: every op these builders can emit must exist in the
// vendored pptx-ops sources as `name: '<op>'`, and the exported effect/trigger
// lists must equal the vendored ANIM_EFFECTS / ANIM_TRIGGERS (the test parses
// the vendored source and fails with the diff). Op objects are compared
// strictly (absent optionals stay absent) and refusals branch on typed
// PptxEngineError codes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAnimationOps,
  PPTX_ANIM_DIRECTIONS,
  PPTX_ANIM_EFFECTS,
  PPTX_ANIM_TRIGGERS,
  PptxEngineError,
  type AnimationEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

/** Plain deck fixture: two slides, one element each - enough for slide and
 * element-exists validation. */
const opened: OpenedPptxLike = {
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { id: "s1", elements: [{ id: "el1", type: "shape" }, { id: "el2", type: "text" }] },
      { id: "s2", elements: [] },
    ],
  },
};

const build = (edit: AnimationEdit) => buildAnimationOps(opened, 960, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

describe("animation vendored guard", () => {
  it("emits only op names registered in the vendored sources", () => {
    const animationOps = readVendored("pptx-ops/src/ops/animation-ops.ts");
    const slideOps = readVendored("pptx-ops/src/ops/slide-ops.ts");
    // animation-ops.ts:284/308/341 and slide-ops.ts:511.
    for (const op of ["addAnimation", "removeAnimation", "reorderAnimation"]) {
      expect(animationOps).toContain("name: '" + op + "'");
    }
    expect(slideOps).toContain("name: 'setAnimations'");
  });

  it("pins PPTX_ANIM_EFFECTS to the vendored PRESET keys (ANIM_EFFECTS)", () => {
    const source = readVendored("pptx-engine/src/animation.ts");
    const preset = source.match(/const PRESET: Record<[\s\S]*?>\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const keys = Array.from(preset.matchAll(/^\s{2}([A-Za-z]+):\s*\{/gm), (m) => m[1]);
    expect(keys).toEqual([...PPTX_ANIM_EFFECTS]);
  });

  it("pins PPTX_ANIM_TRIGGERS to the vendored ANIM_TRIGGERS array", () => {
    const source = readVendored("pptx-engine/src/animation.ts");
    const body = source.match(/ANIM_TRIGGERS: readonly AnimTrigger\[\] = \[([^\]]*)\]/)?.[1] ?? "";
    const vendored = Array.from(body.matchAll(/'([A-Za-z]+)'/g), (m) => m[1]);
    expect(vendored).toEqual([...PPTX_ANIM_TRIGGERS]);
  });

  it("pins PPTX_ANIM_DIRECTIONS to the vendored ANIM_DIRECTIONS array", () => {
    const source = readVendored("pptx-engine/src/animation.ts");
    const body = source.match(/ANIM_DIRECTIONS: readonly AnimDirection\[\] = \[([^\]]*)\]/)?.[1] ?? "";
    const vendored = Array.from(body.matchAll(/'([A-Za-z]+)'/g), (m) => m[1]);
    expect(vendored).toEqual([...PPTX_ANIM_DIRECTIONS]);
  });
});

describe("add_animation op building", () => {
  it("builds the exact addAnimation op with a full field set", () => {
    expect(
      build({
        op: "add_animation",
        slideIndex: 0,
        elementId: "el1",
        effect: "flyIn",
        trigger: "afterPrev",
        durationMs: 700,
        delayMs: 100,
        after: 0,
        direction: "left",
        paragraph: 1,
      }),
    ).toStrictEqual([
      {
        op: "addAnimation",
        target: { slide: 0, el: "el1" },
        effect: "flyIn",
        trigger: "afterPrev",
        durationMs: 700,
        delayMs: 100,
        after: 0,
        direction: "left",
        paragraph: 1,
      },
    ]);
  });

  it("omits every optional the edit leaves out (defaults stay the engine's)", () => {
    expect(build({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: "fade" })).toStrictEqual([
      { op: "addAnimation", target: { slide: 0, el: "el1" }, effect: "fade" },
    ]);
  });

  it("passes motionPath only for the motionPath effect and presetXml through", () => {
    expect(
      build({
        op: "add_animation",
        slideIndex: 0,
        elementId: "el1",
        effect: "motionPath",
        motionPath: "M 0 0 L 0.25 0",
      }),
    ).toStrictEqual([
      {
        op: "addAnimation",
        target: { slide: 0, el: "el1" },
        effect: "motionPath",
        motionPath: "M 0 0 L 0.25 0",
      },
    ]);
    const xml = '<p:par><p:cTn id="1" presetID="10" presetClass="entr"/></p:par>';
    expect(
      build({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: undefined, presetXml: xml } as unknown as AnimationEdit),
    ).toStrictEqual([{ op: "addAnimation", target: { slide: 0, el: "el1" }, presetXml: xml }]);
  });
});

describe("remove_animation op building", () => {
  it("builds the by-seq remove op (0-based position, no element)", () => {
    expect(build({ op: "remove_animation", slideIndex: 0, seq: 2 })).toStrictEqual([
      { op: "removeAnimation", target: { slide: 0 }, seq: 2 },
    ]);
  });

  it("builds the by-element remove op when no seq is given", () => {
    expect(build({ op: "remove_animation", slideIndex: 0, elementId: "el2" })).toStrictEqual([
      { op: "removeAnimation", target: { slide: 0, el: "el2" } },
    ]);
  });

  it("prefers seq when both seq and elementId are present", () => {
    expect(build({ op: "remove_animation", slideIndex: 0, elementId: "el2", seq: 0 })).toStrictEqual([
      { op: "removeAnimation", target: { slide: 0 }, seq: 0 },
    ]);
  });
});

describe("reorder_animation op building", () => {
  it("builds the exact reorderAnimation op (seq + to both required)", () => {
    expect(build({ op: "reorder_animation", slideIndex: 1, seq: 0, to: 3 })).toStrictEqual([
      { op: "reorderAnimation", target: { slide: 1 }, seq: 0, to: 3 },
    ]);
  });

  it("keeps seq === to (the engine treats it as a no-op)", () => {
    expect(build({ op: "reorder_animation", slideIndex: 0, seq: 2, to: 2 })).toStrictEqual([
      { op: "reorderAnimation", target: { slide: 0 }, seq: 2, to: 2 },
    ]);
  });
});

describe("set_animations op building", () => {
  it("builds the exact setAnimations op with a full item", () => {
    expect(
      build({
        op: "set_animations",
        slideIndex: 0,
        items: [
          {
            sourceId: "el1",
            effect: "wipe",
            trigger: "withPrev",
            durationMs: 400,
            delayMs: 50,
            direction: "bottom",
            paragraph: 0,
            motionPath: undefined,
          },
        ],
      }),
    ).toStrictEqual([
      {
        op: "setAnimations",
        target: { slide: 0 },
        items: [
          {
            sourceId: "el1",
            effect: "wipe",
            trigger: "withPrev",
            durationMs: 400,
            delayMs: 50,
            direction: "bottom",
            paragraph: 0,
          },
        ],
      },
    ]);
  });

  it("keeps the item order and drops absent optionals", () => {
    expect(
      build({
        op: "set_animations",
        slideIndex: 0,
        items: [
          { sourceId: "el1", effect: "appear", trigger: "onClick", durationMs: 0, delayMs: 0 },
          { sourceId: "el2", effect: "fadeOut", trigger: "afterPrev", durationMs: 500, delayMs: 0 },
        ],
      }),
    ).toStrictEqual([
      {
        op: "setAnimations",
        target: { slide: 0 },
        items: [
          { sourceId: "el1", effect: "appear", trigger: "onClick", durationMs: 0, delayMs: 0 },
          { sourceId: "el2", effect: "fadeOut", trigger: "afterPrev", durationMs: 500, delayMs: 0 },
        ],
      },
    ]);
  });
});

describe("animation refusals", () => {
  it("refuses a missing slide with anim_no_slide", () => {
    for (const edit of [
      { op: "add_animation", slideIndex: 9, elementId: "el1", effect: "fade" },
      { op: "remove_animation", slideIndex: -1, elementId: "el1" },
      { op: "reorder_animation", slideIndex: 0.5, seq: 0, to: 1 },
      { op: "set_animations", slideIndex: 7, items: [{ sourceId: "el1", effect: "fade", trigger: "onClick", durationMs: 1, delayMs: 0 }] },
    ] as AnimationEdit[]) {
      expect(errCode(() => build(edit))).toBe("anim_no_slide");
    }
  });

  it("refuses a missing target element with anim_no_element", () => {
    expect(errCode(() => build({ op: "add_animation", slideIndex: 0, elementId: "nope", effect: "fade" }))).toBe(
      "anim_no_element",
    );
    expect(errCode(() => build({ op: "remove_animation", slideIndex: 0, elementId: "nope" }))).toBe("anim_no_element");
    expect(errCode(() => build({ op: "remove_animation", slideIndex: 0 }))).toBe("anim_no_element");
    expect(
      errCode(() =>
        build({
          op: "set_animations",
          slideIndex: 0,
          items: [{ sourceId: "nope", effect: "fade", trigger: "onClick", durationMs: 1, delayMs: 0 }],
        }),
      ),
    ).toBe("anim_no_element");
  });

  it("refuses an unknown effect with anim_bad_effect", () => {
    const bad = (effect: unknown): AnimationEdit =>
      ({ op: "add_animation", slideIndex: 0, elementId: "el1", effect }) as AnimationEdit;
    for (const effect of ["fly", "cut", "fade-in", "", 7, null, undefined]) {
      expect(errCode(() => build(bad(effect)))).toBe("anim_bad_effect");
    }
    expect(
      errCode(() =>
        build({
          op: "set_animations",
          slideIndex: 0,
          items: [{ sourceId: "el1", effect: "nope", trigger: "onClick", durationMs: 1, delayMs: 0 }],
        } as unknown as AnimationEdit),
      ),
    ).toBe("anim_bad_effect");
  });

  it("refuses a bad trigger with anim_bad_trigger", () => {
    const bad = (trigger: unknown): AnimationEdit =>
      ({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: "fade", trigger }) as AnimationEdit;
    for (const trigger of ["click", "onclick", "", 1, null]) {
      expect(errCode(() => build(bad(trigger)))).toBe("anim_bad_trigger");
    }
  });

  it("refuses negative/NaN/non-numeric ms with anim_bad_ms", () => {
    const bad = (field: "durationMs" | "delayMs", value: unknown): AnimationEdit =>
      ({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: "fade", [field]: value }) as AnimationEdit;
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "500", null, true]) {
      expect(errCode(() => build(bad("durationMs", value)))).toBe("anim_bad_ms");
      expect(errCode(() => build(bad("delayMs", value)))).toBe("anim_bad_ms");
    }
    expect(
      errCode(() =>
        build({
          op: "set_animations",
          slideIndex: 0,
          items: [{ sourceId: "el1", effect: "fade", trigger: "onClick", durationMs: Number.NaN, delayMs: 0 }],
        }),
      ),
    ).toBe("anim_bad_ms");
  });

  it("refuses a bad after/seq/to with anim_bad_seq", () => {
    const after = (value: unknown): AnimationEdit =>
      ({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: "fade", after: value }) as AnimationEdit;
    for (const value of [-1, 1.5, Number.NaN, "0", null]) {
      expect(errCode(() => build(after(value)))).toBe("anim_bad_seq");
    }
    expect(errCode(() => build({ op: "remove_animation", slideIndex: 0, seq: -1 }))).toBe("anim_bad_seq");
    expect(errCode(() => build({ op: "remove_animation", slideIndex: 0, seq: 1.5 }))).toBe("anim_bad_seq");
    expect(
      errCode(() => build({ op: "reorder_animation", slideIndex: 0, seq: 0 } as unknown as AnimationEdit)),
    ).toBe("anim_bad_seq");
    expect(
      errCode(() => build({ op: "reorder_animation", slideIndex: 0, seq: 0, to: Number.NaN })),
    ).toBe("anim_bad_seq");
  });

  it("refuses empty or malformed items with anim_bad_items", () => {
    expect(errCode(() => build({ op: "set_animations", slideIndex: 0, items: [] }))).toBe("anim_bad_items");
    expect(
      errCode(() => build({ op: "set_animations", slideIndex: 0, items: null } as unknown as AnimationEdit)),
    ).toBe("anim_bad_items");
    expect(
      errCode(() => build({ op: "set_animations", slideIndex: 0, items: [null] } as unknown as AnimationEdit)),
    ).toBe("anim_bad_items");
  });

  it("refuses a bad direction/paragraph/motionPath with their typed codes", () => {
    const add = (fields: Record<string, unknown>): AnimationEdit =>
      ({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: "flyIn", ...fields }) as unknown as AnimationEdit;
    expect(errCode(() => build(add({ direction: "up" })))).toBe("anim_bad_direction");
    expect(errCode(() => build(add({ paragraph: -1 })))).toBe("anim_bad_paragraph");
    expect(errCode(() => build(add({ paragraph: 1.5 })))).toBe("anim_bad_paragraph");
    expect(errCode(() => build(add({ effect: "motionPath", motionPath: "  " })))).toBe("anim_bad_motion_path");
    expect(errCode(() => build(add({ effect: "motionPath", motionPath: 5 })))).toBe("anim_bad_motion_path");
  });

  it("throws a typed PptxEngineError, not a bare Error", () => {
    let caught: unknown;
    try {
      build({ op: "add_animation", slideIndex: 0, elementId: "el1", effect: "nope" } as unknown as AnimationEdit);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PptxEngineError);
    expect((caught as { code?: string }).code).toBe("anim_bad_effect");
  });
});
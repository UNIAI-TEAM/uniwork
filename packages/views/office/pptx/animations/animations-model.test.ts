import { describe, expect, it } from "vitest";
import { PPTX_ANIM_EFFECTS, PPTX_ANIM_TRIGGERS } from "@uniwork/office-engine/pptx";
import {
  animDefaultDurationMs,
  animEffectClass,
  animEffectLabelKey,
  animClassLabelKey,
  animStepNumbers,
  animTriggerLabelKey,
  isPptxAnimEffect,
  isPptxAnimTrigger,
  moveEntry,
  msToSecondsText,
  parseSecondsToMs,
  removeEntryAt,
  resolveEffect,
  resolveTrigger,
  type PptxAnimationEntry,
} from "./animations-model";

const entry = (over: Partial<PptxAnimationEntry> = {}): PptxAnimationEntry => ({
  effect: "fade",
  trigger: "onClick",
  durationMs: 500,
  delayMs: 0,
  ...over,
});

describe("kind guards", () => {
  it("accepts every exported effect and trigger", () => {
    for (const effect of PPTX_ANIM_EFFECTS) expect(isPptxAnimEffect(effect)).toBe(true);
    for (const trigger of PPTX_ANIM_TRIGGERS) expect(isPptxAnimTrigger(trigger)).toBe(true);
  });

  it("refuses anything outside the exported vocabulary", () => {
    expect(isPptxAnimEffect("fly")).toBe(false);
    expect(isPptxAnimEffect(7)).toBe(false);
    expect(isPptxAnimEffect(null)).toBe(false);
    expect(isPptxAnimTrigger("click")).toBe(false);
    expect(isPptxAnimTrigger(undefined)).toBe(false);
  });

  it("resolves an unknown read-back value to a safe default", () => {
    expect(resolveEffect("nope")).toBe("fade");
    expect(resolveEffect("spin")).toBe("spin");
    expect(resolveTrigger("nope")).toBe("onClick");
    expect(resolveTrigger("afterPrev")).toBe("afterPrev");
  });
});

describe("animDefaultDurationMs", () => {
  it("matches the vendored defaultDuration table", () => {
    expect(animDefaultDurationMs("appear")).toBe(0);
    expect(animDefaultDurationMs("disappear")).toBe(0);
    expect(animDefaultDurationMs("spin")).toBe(2000);
    expect(animDefaultDurationMs("grow")).toBe(2000);
    expect(animDefaultDurationMs("bounce")).toBe(2000);
    expect(animDefaultDurationMs("motionPath")).toBe(2000);
    expect(animDefaultDurationMs("pulse")).toBe(1000);
    expect(animDefaultDurationMs("teeter")).toBe(1000);
    expect(animDefaultDurationMs("fade")).toBe(500);
    expect(animDefaultDurationMs("zoomOut")).toBe(500);
  });
});

describe("animEffectClass", () => {
  it("groups effects the way the vendored animClassOf does", () => {
    expect(animEffectClass("appear")).toBe("entrance");
    expect(animEffectClass("fade")).toBe("entrance");
    expect(animEffectClass("flyIn")).toBe("entrance");
    expect(animEffectClass("wipe")).toBe("entrance");
    expect(animEffectClass("wipeDown")).toBe("entrance");
    expect(animEffectClass("splitIn")).toBe("entrance");
    expect(animEffectClass("bounce")).toBe("entrance");
    expect(animEffectClass("flipIn")).toBe("entrance");
    expect(animEffectClass("zoom")).toBe("entrance");
    expect(animEffectClass("pulse")).toBe("emphasis");
    expect(animEffectClass("spin")).toBe("emphasis");
    expect(animEffectClass("grow")).toBe("emphasis");
    expect(animEffectClass("teeter")).toBe("emphasis");
    expect(animEffectClass("disappear")).toBe("exit");
    expect(animEffectClass("fadeOut")).toBe("exit");
    expect(animEffectClass("flyOut")).toBe("exit");
    expect(animEffectClass("wipeOut")).toBe("exit");
    expect(animEffectClass("shrink")).toBe("exit");
    expect(animEffectClass("zoomOut")).toBe("exit");
    expect(animEffectClass("motionPath")).toBe("path");
  });
});

describe("animStepNumbers", () => {
  it("numbers onClick rows and leaves chained rows unnumbered", () => {
    expect(animStepNumbers([entry(), entry(), entry()])).toEqual([1, 2, 3]);
    expect(
      animStepNumbers([
        entry({ trigger: "onClick" }),
        entry({ trigger: "withPrev" }),
        entry({ trigger: "afterPrev" }),
        entry({ trigger: "onClick" }),
      ]),
    ).toEqual([1, null, null, 2]);
  });

  it("leaves a leading chained effect unnumbered (it plays automatically)", () => {
    expect(animStepNumbers([entry({ trigger: "afterPrev" })])).toEqual([null]);
  });

  it("returns an empty list for no entries", () => {
    expect(animStepNumbers([])).toEqual([]);
  });
});

describe("moveEntry", () => {
  it("moves an item and shifts the rest", () => {
    expect(moveEntry(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveEntry(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("returns an unchanged copy for a no-op or an out-of-range move", () => {
    expect(moveEntry(["a", "b"], 1, 1)).toEqual(["a", "b"]);
    expect(moveEntry(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(moveEntry(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(moveEntry(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("never mutates the input array", () => {
    const source = ["a", "b", "c"];
    moveEntry(source, 0, 2);
    expect(source).toEqual(["a", "b", "c"]);
  });
});

describe("removeEntryAt", () => {
  it("drops the entry at the index", () => {
    expect(removeEntryAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("returns an unchanged copy for an out-of-range index", () => {
    expect(removeEntryAt(["a"], -1)).toEqual(["a"]);
    expect(removeEntryAt(["a"], 3)).toEqual(["a"]);
  });
});

describe("parseSecondsToMs / msToSecondsText", () => {
  it("converts a field value to whole milliseconds", () => {
    expect(parseSecondsToMs("0.5")).toEqual({ kind: "ms", ms: 500 });
    expect(parseSecondsToMs("2")).toEqual({ kind: "ms", ms: 2000 });
    expect(parseSecondsToMs("0")).toEqual({ kind: "ms", ms: 0 });
  });

  it("refuses empty, negative and non-numeric input", () => {
    expect(parseSecondsToMs("")).toEqual({ kind: "invalid" });
    expect(parseSecondsToMs("  ")).toEqual({ kind: "invalid" });
    expect(parseSecondsToMs("-1")).toEqual({ kind: "invalid" });
    expect(parseSecondsToMs("abc")).toEqual({ kind: "invalid" });
  });

  it("renders ms back to a trimmed seconds string", () => {
    expect(msToSecondsText(500)).toBe("0.5");
    expect(msToSecondsText(2000)).toBe("2");
    expect(msToSecondsText(0)).toBe("0");
    expect(msToSecondsText(-1)).toBe("0");
  });
});

describe("label keys", () => {
  it("builds office.pptx.animations.* keys", () => {
    expect(animEffectLabelKey("fade")).toBe("effect.fade");
    expect(animTriggerLabelKey("afterPrev")).toBe("trigger.afterPrev");
    expect(animClassLabelKey("path")).toBe("class.path");
  });
});

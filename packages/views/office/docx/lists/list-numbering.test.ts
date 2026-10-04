// B5 (UNI-924): the multilevel-list model — gallery presets, numId allocation
// and the overlay definitions the editor renders markers from.
import { describe, expect, it } from "vitest";
import type { DocxNumberingDef } from "@uniwork/office-engine/docx";
import {
  blankStyleLevels,
  clonePresetLevels,
  DOCX_LIST_PRESETS,
  findRestartableDef,
  levelPreviewText,
  listDefKind,
  listLevelInfos,
  listPresetById,
  listPresetsOf,
  nextListNumId,
  overlayDefForNew,
  overlayDefForRestart,
  type DocxNumberingSnapshot,
} from "./list-numbering";

const DEF7: DocxNumberingDef = {
  numId: "7",
  abstractNumId: "0",
  levels: { 0: { numFmt: "decimal", lvlText: "%1." }, 1: { numFmt: "decimal", lvlText: "%1.%2." } },
  startOverrides: {},
};

const DEF_BULLET: DocxNumberingDef = { numId: "1", abstractNumId: "3", levels: { 0: { numFmt: "bullet", lvlText: "" } }, startOverrides: {} };

const emptyPending = (): DocxNumberingSnapshot => ({ newDefs: [], restartNums: [] });

describe("list style presets", () => {
  it("offers the three libraries with nine levels each", () => {
    expect(DOCX_LIST_PRESETS).toHaveLength(15);
    expect(listPresetsOf("bullets")).toHaveLength(6);
    expect(listPresetsOf("numbers")).toHaveLength(6);
    expect(listPresetsOf("multilevel")).toHaveLength(3);
    for (const preset of DOCX_LIST_PRESETS) expect(preset.levels).toHaveLength(9);
  });

  it("rotates the bullet library glyphs through the standard trio", () => {
    const dot = listPresetById("bullet-dot")!;
    expect(dot.kind).toBe("bullet");
    expect(dot.levels.map((level) => level.lvlText)).toEqual(["•", "○", "■", "•", "○", "■", "•", "○", "■"]);
    expect(dot.levels[8]).toMatchObject({ numFmt: "bullet", indentLeft: 6480, hanging: 360 });
    expect(dot.sampleChain).toBe("• ○ ■");
  });

  it("expands the numbering library pattern per level", () => {
    expect(listPresetById("number-decimal-paren")!.levels.map((level) => level.lvlText).slice(0, 3)).toEqual(["%1)", "%2)", "%3)"]);
    expect(listPresetById("number-roman-dot")!.levels[0]).toMatchObject({ numFmt: "upperRoman", lvlText: "%1." });
    expect(listPresetById("number-roman-dot")!.sample).toBe("I.");
    expect(listPresetById("number-han-comma")!.sample).toBe("一、");
  });

  it("builds the decimal multilevel chain and the Chinese hierarchy", () => {
    // w:lvlText carries the OOXML placeholder tokens (%n = level n's counter),
    // exactly as genoffice's MULTILEVEL_LIBRARY and Word's numbering.xml do;
    // only levelPreviewText interpolates them for the picker.
    const chain = listPresetById("multilevel-decimal")!.levels.map((level) => level.lvlText);
    expect(chain.slice(0, 3)).toEqual(["%1.", "%1.%2.", "%1.%2.%3."]);
    expect(chain[8]).toBe("%1.%2.%3.%4.%5.%6.%7.%8.%9.");
    expect(listPresetById("multilevel-decimal")!.levels[0]!.hanging).toBe(432);
    const chinese = listPresetById("multilevel-chinese")!.levels;
    expect(chinese[0]).toMatchObject({ numFmt: "chineseCountingThousand", lvlText: "%1、", hanging: 425 });
    expect(chinese[1]).toMatchObject({ lvlText: "(%2)", indentLeft: 1440 });
    expect(chinese[2]).toMatchObject({ numFmt: "decimal", lvlText: "%3." });
  });

  it("clones levels so a pending definition never aliases the gallery", () => {
    const preset = listPresetById("multilevel-decimal")!;
    const clone = clonePresetLevels(preset.levels);
    clone[0]!.indentLeft = 1;
    expect(preset.levels[0]!.indentLeft).toBe(720);
  });

  it("returns undefined for an unknown id", () => {
    expect(listPresetById("nope")).toBeUndefined();
  });
});

describe("numId allocation", () => {
  it("starts above the part's max and never below the blank template", () => {
    expect(nextListNumId(new Map(), emptyPending())).toBe("3");
    expect(nextListNumId(new Map([["7", DEF7]]), emptyPending())).toBe("8");
  });

  it("counts this session's pending definitions and restarts", () => {
    const pending = emptyPending();
    pending.newDefs.push({ numId: "9", kind: "ordered" });
    pending.restartNums.push({ numId: "12", abstractNumId: "0", startOverrides: { 0: 1 } });
    expect(nextListNumId(new Map([["7", DEF7]]), pending)).toBe("13");
  });

  it("ignores non-numeric ids", () => {
    const defs = new Map([["new-list-1", { ...DEF7, numId: "new-list-1" }]]);
    expect(nextListNumId(defs, emptyPending())).toBe("3");
  });
});

describe("definition lookups", () => {
  it("reads the kind from the first level", () => {
    expect(listDefKind(DEF7)).toBe("ordered");
    expect(listDefKind(DEF_BULLET)).toBe("bullet");
  });

  it("finds a same-kind definition but never this session's pending overlay", () => {
    const defs = new Map([
      ["7", DEF7],
      ["1", DEF_BULLET],
    ]);
    const pending = emptyPending();
    pending.newDefs.push({ numId: "7", kind: "ordered" });
    expect(findRestartableDef(defs, pending, "ordered")).toBeUndefined();
    expect(findRestartableDef(defs, emptyPending(), "ordered")).toBe(DEF7);
    expect(findRestartableDef(defs, emptyPending(), "bullet")).toBe(DEF_BULLET);
    expect(findRestartableDef(new Map([["7", DEF7]]), emptyPending(), "bullet")).toBeUndefined();
  });

  it("summarises the levels in order and previews marker text", () => {
    expect(listLevelInfos(DEF7)).toEqual([
      { ilvl: 0, numFmt: "decimal", lvlText: "%1." },
      { ilvl: 1, numFmt: "decimal", lvlText: "%1.%2." },
    ]);
    expect(listLevelInfos(undefined)).toEqual([]);
    expect(levelPreviewText({ numFmt: "decimal", lvlText: "%1.%2." })).toBe("1.1.");
    expect(levelPreviewText({ numFmt: "bullet", lvlText: "" })).toBe("•");
    expect(levelPreviewText({ numFmt: "bullet", lvlText: "○" })).toBe("○");
  });

  it("builds the blank-template overlay for a new definition", () => {
    expect(blankStyleLevels("ordered").map((level) => level.lvlText)).toEqual(["%1.", "%2.", "%3.", "%4.", "%5."]);
    const overlay = overlayDefForNew({ numId: "9", kind: "bullet" });
    expect(overlay).toMatchObject({ numId: "9", abstractNumId: "pending-9", startOverrides: {} });
    expect(overlay.levels[0]).toMatchObject({ numFmt: "bullet", start: 1, indentLeft: 720, hanging: 360 });
    expect(Object.keys(overlay.levels)).toHaveLength(5);
  });

  it("keeps the authored levels when a preset defines them", () => {
    const overlay = overlayDefForNew({ numId: "9", kind: "ordered", levels: [{ numFmt: "upperRoman", lvlText: "%1.", indentLeft: 1440, hanging: 432, start: 2 }] });
    expect(overlay.levels[0]).toEqual({ numFmt: "upperRoman", lvlText: "%1.", indentLeft: 1440, hanging: 432, start: 2 });
    expect(Object.keys(overlay.levels)).toHaveLength(1);
  });

  it("builds a restart overlay from the source abstractNum, or null when it is gone", () => {
    const overlay = overlayDefForRestart(new Map([["7", DEF7]]), { numId: "9", abstractNumId: "0", startOverrides: { 1: 3 } });
    expect(overlay).toMatchObject({ numId: "9", abstractNumId: "0", startOverrides: { 1: 3 } });
    expect(overlay?.levels[1]).toEqual(DEF7.levels[1]);
    expect(overlayDefForRestart(new Map(), { numId: "9", abstractNumId: "0", startOverrides: {} })).toBeNull();
  });
});

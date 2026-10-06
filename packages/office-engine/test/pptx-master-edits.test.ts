// B6e (UNI-927) - master/layout part-addressed op builder tests.
//
// Vendored guard first: every op the builder can emit must be registered in
// the vendored pptx-ops sources as `name: '<op>'` AND its registration block
// must really opt in to part targets (`allowPart: true`). Op objects are
// compared strictly, refusals branch on typed PptxEngineError codes. The edit
// -> savePptx -> reopen round-trip is the wire round.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMasterOps,
  listMasterPartInfos,
  type MasterEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const readVendored = (relative: string): string =>
  readFileSync(join(REPO, "packages", "office-upstream", "upstream", "packages", relative), "utf8");

const MASTER = "ppt/slideMasters/slideMaster1.xml";
const LAYOUT1 = "ppt/slideLayouts/slideLayout1.xml";
const LAYOUT2 = "ppt/slideLayouts/slideLayout2.xml";

const entries = new Map<string, unknown>([
  [MASTER, '<p:sldMaster><p:cSld name="Office Theme"><p:spTree/></p:cSld></p:sldMaster>'],
  [
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    '<Relationships>' +
      '<Relationship Id="rId2" Type="http://x/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>' +
      '<Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml" Type="http://x/relationships/slideLayout"/>' +
      '<Relationship Id="rId9" Type="http://x/relationships/theme" Target="../theme/theme1.xml"/>' +
      "</Relationships>",
  ],
  [LAYOUT1, '<p:sldLayout><p:cSld name="Title Slide"><p:spTree/></p:cSld></p:sldLayout>'],
  [LAYOUT2, "<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>"],
  ["ppt/slides/slide1.xml", "<p:sld/>"],
]);

const opened: OpenedPptxLike = {
  deck: { size: { cx: 9144000, cy: 5143500 }, slides: [{ id: "s1", elements: [] }] },
  archive: { entries, readText: (path: string) => entries.get(path) as string | undefined },
};

const build = (edit: MasterEdit, fit = 960) => buildMasterOps(opened, fit, edit);

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const FILES: Record<string, string> = {
  setText: "pptx-ops/src/ops/text-ops.ts",
  setTransform: "pptx-ops/src/ops/element-ops.ts",
  setFill: "pptx-ops/src/ops/core-ops.ts",
  setStroke: "pptx-ops/src/ops/core-ops.ts",
  deleteElement: "pptx-ops/src/ops/core-ops.ts",
};

/** The registration block of `name: '<op>'` up to the next top-level register. */
const registrationBlock = (source: string, op: string): string => {
  const start = source.indexOf("name: '" + op + "'");
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\nregister({", start);
  return source.slice(start, next < 0 ? undefined : next);
};

const SAMPLE_EDITS: MasterEdit[] = [
  { op: "master_edit_text", part: MASTER, elementId: "e1", paragraphs: [{ runs: [{ text: "Hi" }] }] },
  { op: "master_set_transform", part: LAYOUT1, elementId: "e1", xPx: 10, yPx: 10, wPx: 100, hPx: 50 },
  { op: "master_set_fill", part: MASTER, elementId: "e1", fill: "#112233" },
  { op: "master_set_stroke", part: MASTER, elementId: "e1", stroke: null },
  { op: "master_delete_element", part: MASTER, elementId: "e1" },
];

describe("master vendored guard", () => {
  it("emits only registered ops whose registration opts in to allowPart", () => {
    const emitted = SAMPLE_EDITS.flatMap((edit) => build(edit));
    expect(emitted.map((op) => op.op).sort()).toStrictEqual([
      "deleteElement",
      "setFill",
      "setStroke",
      "setText",
      "setTransform",
    ]);
    for (const op of emitted) {
      const source = readVendored(FILES[op.op]!);
      expect(source).toContain("name: '" + op.op + "'");
      expect(registrationBlock(source, op.op)).toContain("allowPart: true");
    }
  });

  it("targets a part, never a slide", () => {
    for (const op of SAMPLE_EDITS.flatMap((edit) => build(edit))) {
      expect(op.target).toMatchObject({ el: "e1" });
      expect(op.target).not.toHaveProperty("slide");
      expect(typeof op.target?.part).toBe("string");
    }
  });

  it("vendored ops outside the five (e.g. setFont) do not opt in", () => {
    const source = readVendored("pptx-ops/src/ops/text-ops.ts");
    expect(registrationBlock(source, "setFont")).not.toContain("allowPart");
  });
});

describe("listMasterPartInfos", () => {
  it("lists the master then its layouts in part order with names", () => {
    expect(listMasterPartInfos(opened)).toStrictEqual([
      { partPath: MASTER, kind: "master", name: "Office Theme" },
      { partPath: LAYOUT1, kind: "layout", name: "Title Slide" },
      { partPath: LAYOUT2, kind: "layout", name: "slideLayout2" },
    ]);
  });

  it("accepts a Record entries archive and answers empty without an archive", () => {
    const record: OpenedPptxLike = {
      deck: { slides: [] },
      archive: { entries: { [MASTER]: "<p:sldMaster/>" }, readText: (p: string) => (p === MASTER ? "<p:sldMaster/>" : undefined) },
    };
    expect(listMasterPartInfos(record)).toStrictEqual([{ partPath: MASTER, kind: "master", name: "slideMaster1" }]);
    expect(listMasterPartInfos({ deck: { slides: [] } })).toStrictEqual([]);
  });
});

describe("buildMasterOps exact ops", () => {
  it("master_edit_text -> setText with paragraphs", () => {
    expect(build(SAMPLE_EDITS[0]!)).toStrictEqual([
      { op: "setText", target: { part: MASTER, el: "e1" }, paragraphs: [{ runs: [{ text: "Hi" }] }] },
    ]);
  });

  it("master_set_transform converts px -> EMU at the fit width (like slides)", () => {
    // 9144000 EMU = 960 px at 96 DPI base -> scale 1 at fit width 960.
    expect(build(SAMPLE_EDITS[1]!)).toStrictEqual([
      {
        op: "setTransform",
        target: { part: LAYOUT1, el: "e1" },
        box: { x: 95250, y: 95250, cx: 952500, cy: 476250 },
        rotDeg: 0,
      },
    ]);
    const half = build({ op: "master_set_transform", part: MASTER, elementId: "e1", xPx: 10, yPx: 0, wPx: 0, hPx: 20, rotationDeg: 15 }, 480);
    expect(half).toStrictEqual([
      {
        op: "setTransform",
        target: { part: MASTER, el: "e1" },
        box: { x: 190500, y: 0, cx: 1, cy: 381000 },
        rotDeg: 15,
      },
    ]);
  });

  it("master_set_fill covers none, solid and gradient", () => {
    expect(build({ op: "master_set_fill", part: MASTER, elementId: "e1", fill: "none" })[0]).toStrictEqual({
      op: "setFill",
      target: { part: MASTER, el: "e1" },
      fill: "none",
    });
    expect(build(SAMPLE_EDITS[2]!)[0]).toStrictEqual({ op: "setFill", target: { part: MASTER, el: "e1" }, fill: "#112233" });
    const gradient = {
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 1, color: "#FFFFFF" },
      ],
      angle: 5400000,
    };
    expect(build({ op: "master_set_fill", part: MASTER, elementId: "e1", fill: gradient })[0]).toStrictEqual({
      op: "setFill",
      target: { part: MASTER, el: "e1" },
      fill: gradient,
    });
  });

  it("master_set_stroke covers a patch and null", () => {
    expect(build(SAMPLE_EDITS[3]!)[0]).toStrictEqual({ op: "setStroke", target: { part: MASTER, el: "e1" }, stroke: null });
    expect(
      build({ op: "master_set_stroke", part: MASTER, elementId: "e1", stroke: { color: "#FF0000", widthEmu: 12700, dash: "dash", cap: "rnd" } })[0],
    ).toStrictEqual({
      op: "setStroke",
      target: { part: MASTER, el: "e1" },
      stroke: { color: "#FF0000", widthEmu: 12700, dash: "dash", cap: "rnd" },
    });
  });

  it("master_delete_element -> deleteElement", () => {
    expect(build(SAMPLE_EDITS[4]!)).toStrictEqual([{ op: "deleteElement", target: { part: MASTER, el: "e1" } }]);
  });
});

describe("buildMasterOps refusals", () => {
  const base = { part: MASTER, elementId: "e1" };

  it("refuses an unknown or missing part", () => {
    expect(errCode(() => build({ op: "master_delete_element", part: "ppt/slides/slide1.xml", elementId: "e1" }))).toBe("bad_master_part");
    expect(errCode(() => build({ op: "master_delete_element", part: "", elementId: "e1" }))).toBe("bad_master_part");
    expect(errCode(() => buildMasterOps({ deck: { slides: [] } }, 960, SAMPLE_EDITS[4]!))).toBe("bad_master_part");
  });

  it("refuses an empty element id", () => {
    expect(errCode(() => build({ op: "master_delete_element", part: MASTER, elementId: "" }))).toBe("no_master_element");
  });

  it("refuses an unknown edit kind", () => {
    expect(errCode(() => build({ op: "master_zap", ...base } as unknown as MasterEdit))).toBe("bad_master_edit");
  });

  it("refuses bad text payloads", () => {
    expect(errCode(() => build({ op: "master_edit_text", ...base, paragraphs: [] }))).toBe("bad_master_text");
    expect(errCode(() => build({ op: "master_edit_text", ...base, paragraphs: [{ runs: [{ text: 5 as unknown as string }] }] }))).toBe("bad_master_text");
  });

  it("refuses bad geometry", () => {
    const geo = { op: "master_set_transform" as const, ...base, xPx: 0, yPx: 0, wPx: 10, hPx: 10 };
    expect(errCode(() => build({ ...geo, wPx: -1 }))).toBe("bad_master_geometry");
    expect(errCode(() => build({ ...geo, xPx: Number.NaN }))).toBe("bad_master_geometry");
    expect(errCode(() => build({ ...geo, rotationDeg: Number.POSITIVE_INFINITY }))).toBe("bad_master_geometry");
    expect(errCode(() => build(geo, 0))).toBe("bad_fit_width");
  });

  it("refuses bad fills", () => {
    const fill = (value: unknown) => build({ op: "master_set_fill", ...base, fill: value as never });
    expect(errCode(() => fill("red"))).toBe("bad_master_fill");
    expect(errCode(() => fill(5))).toBe("bad_master_fill");
    expect(errCode(() => fill({ stops: [{ pos: 0, color: "#000000" }] }))).toBe("bad_master_fill");
    expect(errCode(() => fill({ stops: [{ pos: 2, color: "#000000" }, { pos: 1, color: "#FFFFFF" }] }))).toBe("bad_master_fill");
  });

  it("refuses bad strokes", () => {
    const stroke = (value: unknown) => build({ op: "master_set_stroke", ...base, stroke: value as never });
    expect(errCode(() => stroke("x"))).toBe("bad_master_stroke");
    expect(errCode(() => stroke({ color: "#FF0000", widthEmu: 0 }))).toBe("bad_master_stroke");
    expect(errCode(() => stroke({ color: "nope", widthEmu: 12700 }))).toBe("bad_master_stroke");
    expect(errCode(() => stroke({ color: "#FF0000", widthEmu: 12700, cap: "weird" }))).toBe("bad_master_stroke");
  });
});

// B6 wire (UNI-927) - master/layout READ path + model dispatch.
//
// readMasterElements (pure, parser injected like the engine seam binds the
// vendored parseMasterPart), the adapter's masterParts / masterElements next to
// slideNotes, and the master_* edits through the single fake harness
// (test/fake-pptx-engine.ts handles the five part-addressed ops).
import { describe, expect, it } from "vitest";
import { bindPptxEngine, createPptxAdapter, readMasterElements, type OpenedPptxLike } from "../src/pptx";
import {
  createFakePptxEngine,
  createFakePptxOps,
  FAKE_LAYOUT_PART,
  FAKE_MASTER_PART,
  fakeMasterFixture,
  makeFakeMasterXml,
} from "./fake-pptx-engine";
import { makeFakePptxBytes, para } from "./fake-pptx-fixtures";

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "";
};

const open = async (engine = createFakePptxEngine()) => {
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps() });
  const out = await adapter.open({
    bytes: makeFakePptxBytes(fakeMasterFixture()),
    format: "pptx",
    document_id: "masters",
  });
  if (out.outcome !== "opened") throw new Error("open failed");
  return { adapter, ref: out.document_model_ref };
};

describe("readMasterElements", () => {
  const opened = async (): Promise<OpenedPptxLike> => {
    const engine = createFakePptxEngine();
    return engine.openPptx(makeFakePptxBytes(fakeMasterFixture()));
  };
  const parse = createFakePptxEngine().parseMasterPart!;

  it("lists id, type, label, px box, placeholder, solid fill and text", async () => {
    const deck = await opened();
    const elements = readMasterElements(deck, 960, FAKE_MASTER_PART, parse);
    expect(elements.map((e) => e.id)).toEqual(["m_title", "m_body", "m_logo"]);
    // 9144000 EMU = 960 px at fit 960 -> 9525 EMU per px.
    expect(elements[0]).toEqual({
      id: "m_title",
      type: "shape",
      label: "title: Click to edit Master title style",
      box: { x: 48, y: 21.6, w: 864, h: 90 },
      placeholder: "title",
      fill: "#112233",
      text: "Click to edit Master title style",
    });
    expect(elements[1]).toMatchObject({ id: "m_body", label: "body", placeholder: "body", fill: null, text: "" });
    // A picture has no text and no solid fill; the label is its type.
    expect(elements[2]).toMatchObject({ id: "m_logo", type: "picture", label: "picture", fill: null });
    expect(elements[2]).not.toHaveProperty("text");
    expect(elements[2]).not.toHaveProperty("placeholder");
  });

  it("reports the durable e_<cNvPr id> form, which survives the per-transaction re-parse (T01)", async () => {
    const deck = await opened();
    const withAnchors = (archive: unknown, part: string) => {
      const parsed = parse(archive, part)!;
      return {
        ...parsed,
        elements: parsed.elements.map((element, index) =>
          index === 0 ? { ...element, anchor: { originalXml: '<p:sp><p:nvSpPr><p:cNvPr id="7" name="Title 1"/></p:nvSpPr></p:sp>' } }
          : index === 1 ? { ...element, nvId: 9 } : element),
      };
    };
    expect(readMasterElements(deck, 960, FAKE_MASTER_PART, withAnchors).map((e) => e.id)).toEqual(["e_7", "e_9", "m_logo"]);
  });

  it("reports the placeholder idx from the parsed shape XML so a style edit can address one of two same-type slots", async () => {
    const deck = await opened();
    const ph = (nvPr: string) => ({ anchor: { originalXml: '<p:sp><p:nvSpPr><p:cNvPr id="3" name="C"/><p:cNvSpPr/><p:nvPr>' + nvPr + "</p:nvPr></p:nvSpPr></p:sp>" } });
    const withIdx = (archive: unknown, part: string) => {
      const parsed = parse(archive, part)!;
      return {
        ...parsed,
        elements: parsed.elements.map((element, index) =>
          index === 0 ? { ...element, ...ph('<p:ph type="body" idx="2"/>') } : index === 1 ? { ...element, ...ph('<p:ph type="title"/>') } : element),
      };
    };
    const [first, second, third] = readMasterElements(deck, 960, FAKE_MASTER_PART, withIdx);
    expect(first?.idx).toBe(2);
    expect(second).not.toHaveProperty("idx");
    expect(third).not.toHaveProperty("idx");
  });

  it("scales the box with the fit width", async () => {
    const deck = await opened();
    const half = readMasterElements(deck, 480, FAKE_MASTER_PART, parse);
    expect(half[0]?.box).toEqual({ x: 24, y: 10.8, w: 432, h: 45 });
  });

  it("truncates long text in the label but keeps the full text", async () => {
    const long = "x".repeat(80);
    const deck = await opened();
    (deck.archive!.entries as Map<string, unknown>).set(
      FAKE_LAYOUT_PART,
      makeFakeMasterXml(
        "L",
        [{ id: "a", type: "text", transform: { offset: { x: 0, y: 0, cx: 9525, cy: 9525 }, rot: 0 }, text: { paragraphs: [para(long)] } }],
        "p:sldLayout",
      ),
    );
    const [only] = readMasterElements(deck, 960, FAKE_LAYOUT_PART, parse);
    expect(only?.label).toBe("text: " + "x".repeat(39) + "…");
    expect(only?.text).toBe(long);
  });

  it("refuses an unknown part, an unbound parser and a part that parses to nothing", async () => {
    const deck = await opened();
    expect(errCode(() => readMasterElements(deck, 960, "ppt/slideMasters/slideMaster9.xml", parse))).toBe("bad_master_part");
    expect(errCode(() => readMasterElements(deck, 960, FAKE_MASTER_PART))).toBe("master_unbound");
    expect(errCode(() => readMasterElements(deck, 960, FAKE_MASTER_PART, () => null))).toBe("bad_master_part");
    expect(errCode(() => readMasterElements(deck, 0, FAKE_MASTER_PART, parse))).toBe("bad_fit_width");
  });
});

describe("pptx adapter master read path", () => {
  it("masterParts lists the master then its layouts, masterElements the part's elements", async () => {
    const { adapter, ref } = await open();
    expect(adapter.masterParts(ref)).toEqual([
      { partPath: FAKE_MASTER_PART, kind: "master", name: "Office Theme" },
      { partPath: FAKE_LAYOUT_PART, kind: "layout", name: "Title Slide" },
    ]);
    expect(adapter.masterElements(ref, FAKE_LAYOUT_PART).map((e) => e.id)).toEqual(["l_title"]);
  });

  it("refuses with no model, an unknown part, and an engine without parseMasterPart", async () => {
    const { adapter, ref } = await open();
    expect(errCode(() => adapter.masterParts("nope"))).toBe("not_found");
    expect(errCode(() => adapter.masterElements("nope", FAKE_MASTER_PART))).toBe("not_found");
    expect(errCode(() => adapter.masterElements(ref, "ppt/slideMasters/slideMaster9.xml"))).toBe("bad_master_part");

    const fake = createFakePptxEngine();
    const { parseMasterPart: _unbound, ...withoutParser } = fake;
    const bare = await open(withoutParser as ReturnType<typeof createFakePptxEngine>);
    expect(errCode(() => bare.adapter.masterElements(bare.ref, FAKE_MASTER_PART))).toBe("master_unbound");
    // The part list needs no parser.
    expect(bare.adapter.masterParts(bare.ref)).toHaveLength(2);
  });

  it("bindPptxEngine forwards parseMasterPart only when the bundle exports it", () => {
    const base = { openPptx: async () => ({}) as OpenedPptxLike, savePptx: async () => new Uint8Array(), commitSaved: () => undefined };
    const part = { elements: [] };
    const bound = bindPptxEngine({ ...base, parseMasterPart: (_a: unknown, p: string) => ({ ...part, path: p }) });
    expect(bound.parseMasterPart?.({}, "ppt/slideMasters/slideMaster1.xml")).toEqual({ elements: [], path: "ppt/slideMasters/slideMaster1.xml" });
    expect(bindPptxEngine(base).parseMasterPart).toBeUndefined();
  });
});

describe("master_* edits through the model", () => {
  it("each kind lands on the part and journals one part-addressed op", async () => {
    const { adapter, ref } = await open();
    const model = adapter.sessionOf(ref).model;
    adapter.edit(ref, { op: "master_edit_text", part: FAKE_MASTER_PART, elementId: "m_title", paragraphs: [para("New title")] });
    adapter.edit(ref, { op: "master_set_transform", part: FAKE_MASTER_PART, elementId: "m_title", xPx: 96, yPx: 48, wPx: 192, hPx: 96 });
    adapter.edit(ref, { op: "master_set_fill", part: FAKE_MASTER_PART, elementId: "m_title", fill: "#FF0000" });
    adapter.edit(ref, { op: "master_set_stroke", part: FAKE_MASTER_PART, elementId: "m_title", stroke: { color: "#00FF00", widthEmu: 12700 } });
    adapter.edit(ref, { op: "master_delete_element", part: FAKE_MASTER_PART, elementId: "m_logo" });
    expect(model.revision).toBe(5);
    expect(model.journal.map((r) => [r.op.op, r.op.target?.part, r.op.target?.slide])).toEqual([
      ["setText", FAKE_MASTER_PART, undefined],
      ["setTransform", FAKE_MASTER_PART, undefined],
      ["setFill", FAKE_MASTER_PART, undefined],
      ["setStroke", FAKE_MASTER_PART, undefined],
      ["deleteElement", FAKE_MASTER_PART, undefined],
    ]);
    const elements = adapter.masterElements(ref, FAKE_MASTER_PART);
    expect(elements.map((e) => e.id)).toEqual(["m_title", "m_body"]);
    expect(elements[0]).toMatchObject({ text: "New title", fill: "#FF0000", box: { x: 96, y: 48, w: 192, h: 96 } });
  });

  it("refuses a missing element with the executor's guided error and leaves the model untouched", async () => {
    const { adapter, ref } = await open();
    const model = adapter.sessionOf(ref).model;
    let message = "";
    try {
      adapter.edit(ref, { op: "master_set_fill", part: FAKE_MASTER_PART, elementId: "ghost", fill: "#112233" });
    } catch (error) {
      expect((error as { code?: string }).code).toBe("dry_run_failed");
      message = String((error as Error).message);
    }
    expect(message).toContain("no element ghost on part " + FAKE_MASTER_PART);
    expect(message).toContain("Available: [m_title, m_body, m_logo]");
    expect(model.revision).toBe(0);
    expect(model.dirty).toBe(false);
  });

  it("refuses an invalid master edit before any transaction runs", async () => {
    const { adapter, ref } = await open();
    const model = adapter.sessionOf(ref).model;
    expect(errCode(() => adapter.edit(ref, { op: "master_delete_element", part: "ppt/slideMasters/slideMaster9.xml", elementId: "m_logo" }))).toBe(
      "bad_master_part",
    );
    expect(errCode(() => adapter.edit(ref, { op: "master_set_fill", part: FAKE_MASTER_PART, elementId: "m_body", fill: "blue" }))).toBe(
      "bad_master_fill",
    );
    expect(model.revision).toBe(0);
  });
});

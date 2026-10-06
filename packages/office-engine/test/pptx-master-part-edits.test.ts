// Part-XML master edits (UNI-939 T01): rename a master/layout, add and remove
// a placeholder, set a placeholder text style. Pure transforms first, then the
// model -> serialize -> reopen round trip on the fake engine (the real-engine
// round trip lives in apps/web pptx-runtime-masters.real.test.ts).
import { describe, expect, it } from "vitest";
import { createPptxAdapter, PptxEngineError, type PptxEdit } from "../src/pptx";
import { addPlaceholderXml, removePlaceholderXml, renamePartXml, setTextStyleXml } from "../src/pptx/edits/master-part-xml";
import {
  createFakePptxEngine,
  createFakePptxOps,
  decodeFakePptx,
  FAKE_LAYOUT_PART,
  FAKE_MASTER_PART,
  XML_LAYOUT,
  XML_MASTER,
  xmlMasterFixture,
} from "./fake-pptx-engine";
import { makeFakePptxBytes } from "./fake-pptx-fixtures";

const box = { xEmu: 1, yEmu: 2, cxEmu: 3, cyEmu: 4 };

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof PptxEngineError) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("master part XML transforms", () => {
  it("renames the part through <p:cSld name>, escaping the value and adding the attribute when absent", () => {
    expect(renamePartXml(XML_LAYOUT, 'Q&A "deck"')).toContain('<p:cSld name="Q&amp;A &quot;deck&quot;">');
    expect(renamePartXml("<p:sldLayout><p:cSld><p:spTree/></p:cSld></p:sldLayout>", "New")).toContain('<p:cSld name="New">');
    expect(refusal(() => renamePartXml("<p:sldLayout/>", "x"))).toBe("master_part_malformed");
  });

  it("appends a placeholder with the next shape id and placeholder index, and refuses a second title", () => {
    const { xml, placeholder } = addPlaceholderXml(XML_MASTER, "body", box, "Content Placeholder");
    expect(placeholder).toEqual({ type: "body", idx: 11 });
    expect(xml).toContain('<p:cNvPr id="4" name="Content Placeholder 4"/>');
    expect(xml).toContain('<p:ph type="body" idx="11"/>');
    expect(xml).toContain('<a:off x="1" y="2"/><a:ext cx="3" cy="4"/>');
    expect(xml.indexOf('idx="11"')).toBeLessThan(xml.indexOf("</p:spTree>"));
    expect(refusal(() => addPlaceholderXml(XML_MASTER, "title", box, "Title"))).toBe("master_placeholder_exists");
    expect(addPlaceholderXml(XML_LAYOUT, "title", box, "Title").placeholder).toEqual({ type: "title" });
  });

  it("removes the matching placeholder shape only, and refuses a slot the part lacks", () => {
    const xml = removePlaceholderXml(XML_MASTER, { type: "dt" });
    expect(xml).not.toContain('type="dt"');
    expect(xml).toContain('type="title"');
    expect(refusal(() => removePlaceholderXml(XML_MASTER, { type: "dt", idx: 3 }))).toBe("master_no_placeholder");
  });

  it("patches the master title style in <p:txStyles>, keeping the other attributes and children", () => {
    const xml = setTextStyleXml(XML_MASTER, true, { type: "title" }, { sizePt: 40, bold: true, color: "#112233", font: "Inter" });
    expect(xml).toContain('<a:lvl1pPr algn="l"><a:defRPr sz="4000" b="1"><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="Inter"/></a:defRPr></a:lvl1pPr>');
    // Body level 3 is created in place, after the existing level 1.
    const body = setTextStyleXml(XML_MASTER, true, { type: "body" }, { level: 3, italic: true });
    expect(body).toContain('<p:bodyStyle><a:lvl1pPr/><a:lvl3pPr><a:defRPr i="1"/></a:lvl3pPr></p:bodyStyle>');
  });

  it("patches a layout placeholder through its <a:lstStyle>", () => {
    const xml = setTextStyleXml(XML_LAYOUT, false, { type: "ctrTitle" }, { sizePt: 54 });
    expect(xml).toContain('<a:lstStyle><a:lvl1pPr><a:defRPr sz="5400"/></a:lvl1pPr></a:lstStyle>');
    expect(refusal(() => setTextStyleXml(XML_LAYOUT, false, { type: "body" }, { sizePt: 10 }))).toBe("master_no_placeholder");
  });
});

async function opened() {
  const engine = createFakePptxEngine();
  const adapter = createPptxAdapter({ engine, ops: createFakePptxOps() });
  const result = await adapter.open({ bytes: makeFakePptxBytes(xmlMasterFixture()), format: "pptx", document_id: "masters" });
  if (result.outcome !== "opened") throw new Error("open failed");
  return { adapter, ref: result.document_model_ref };
}

describe("master part edits through the model", () => {
  it("applies all four kinds, survives serialize -> reopen, and lists the renamed layout", async () => {
    const { adapter, ref } = await opened();
    const edits: PptxEdit[] = [
      { op: "master_rename", part: FAKE_LAYOUT_PART, name: "Big Title" },
      { op: "master_add_placeholder", part: FAKE_LAYOUT_PART, placeholder: "body", xPx: 10, yPx: 20, wPx: 300, hPx: 100 },
      { op: "master_remove_placeholder", part: FAKE_MASTER_PART, placeholder: "dt" },
      { op: "master_set_text_style", part: FAKE_MASTER_PART, placeholder: "title", sizePt: 36, color: "#AA0000" },
    ];
    for (const edit of edits) adapter.edit(ref, edit);
    expect(adapter.masterParts(ref).find((part) => part.partPath === FAKE_LAYOUT_PART)?.name).toBe("Big Title");

    const saved = await adapter.serialize({ document_model_ref: ref, format: "pptx" });
    const entries = decodeFakePptx(saved.bytes).entries ?? {};
    expect(entries[FAKE_LAYOUT_PART]).toContain('<p:cSld name="Big Title">');
    expect(entries[FAKE_LAYOUT_PART]).toContain('<p:ph type="body" idx="1"/>');
    expect(entries[FAKE_MASTER_PART]).not.toContain('type="dt"');
    expect(entries[FAKE_MASTER_PART]).toContain('<a:defRPr sz="3600">');
    expect(entries[FAKE_MASTER_PART]).toContain('<a:srgbClr val="AA0000"/>');
  });

  it("refuses bad input before writing anything", async () => {
    const { adapter, ref } = await opened();
    const bad: PptxEdit[] = [
      { op: "master_rename", part: FAKE_LAYOUT_PART, name: "  " },
      { op: "master_rename", part: "ppt/slideLayouts/slideLayout9.xml", name: "x" },
      { op: "master_add_placeholder", part: FAKE_LAYOUT_PART, placeholder: "nope" as "body", xPx: 0, yPx: 0, wPx: 10, hPx: 10 },
      { op: "master_add_placeholder", part: FAKE_LAYOUT_PART, placeholder: "body", xPx: 0, yPx: 0, wPx: 0, hPx: 10 },
      { op: "master_set_text_style", part: FAKE_MASTER_PART, placeholder: "title" },
      { op: "master_set_text_style", part: FAKE_MASTER_PART, placeholder: "title", color: "red" },
      { op: "master_set_text_style", part: FAKE_MASTER_PART, placeholder: "title", level: 10, sizePt: 12 },
      { op: "master_remove_placeholder", part: FAKE_MASTER_PART, placeholder: "dt", idx: -1 },
    ];
    for (const edit of bad) expect(() => adapter.edit(ref, edit), edit.op).toThrow(PptxEngineError);
    const entries = decodeFakePptx((await adapter.serialize({ document_model_ref: ref, format: "pptx" })).bytes).entries ?? {};
    expect(entries[FAKE_LAYOUT_PART]).toBe(XML_LAYOUT);
    expect(entries[FAKE_MASTER_PART]).toBe(XML_MASTER);
  });
});

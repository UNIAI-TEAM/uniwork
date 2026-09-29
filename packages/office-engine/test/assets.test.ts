// Asset oracle tests — inventories capture what a package carries, diffs
// catch lost relationships, and preserved-but-uneditable constructs surface
// as typed warnings (copy consent), never silently.
import { describe, expect, it } from "vitest";
import {
  diffDocxAssets,
  docxPartKinds,
  inventoryDocxAssets,
  unsupportedDocxWarnings,
} from "../src/docx";
import {
  diffPptxAssets,
  inventoryPptxAssets,
  unsupportedPptxWarnings,
} from "../src/pptx";
import { createFakeDocxEngine, makeFakeDocxBytes } from "./fake-docx-engine";
import { createFakePptxEngine } from "./fake-pptx-engine";
import { makeFakePptxBytes } from "./fake-pptx-fixtures";

describe("docx asset inventory", () => {
  const parsed = () =>
    createFakeDocxEngine().parseDocx(
      makeFakeDocxBytes({
        blocks: [
          { type: "image", imageDataUrl: "data:image/png;base64,AA" },
          { type: "paragraph", runs: [{ text: "x" }] },
          { type: "oleObject", oleProgId: "Excel.Sheet.12" },
        ],
        extras: { chartParts: { "word/charts/c1.xml": "<c/>", "word/charts/c2.xml": "<c/>" } },
        parts: {
          "word/media/i1.png": "P",
          "word/embeddings/e1.xlsx": "E",
          "word/vbaProject.bin": "V",
          "customXml/s1.xml": "<s/>",
        },
      }),
    );

  it("counts images, charts, ole objects, fonts, hf images and parts", async () => {
    const inv = inventoryDocxAssets(await parsed(), ["word/media/i1.png", "word/embeddings/e1.xlsx"]);
    expect(inv.images).toBe(1);
    expect(inv.oleObjects).toBe(1);
    expect(inv.chartParts).toEqual(["word/charts/c1.xml", "word/charts/c2.xml"]);
    expect(inv.parts).toContain("word/embeddings/e1.xlsx");
  });

  it("part kinds bucket for the preservation oracle", () => {
    const kinds = docxPartKinds([
      "word/media/a.png",
      "word/embeddings/b.xlsx",
      "word/charts/c.xml",
      "word/fonts/f.odttf",
      "customXml/x.xml",
      "word/vbaProject.bin",
      "docProps/core.xml",
    ]);
    expect(kinds).toMatchObject({ media: 1, embeddings: 1, charts: 1, fonts: 1, customXml: 1, vba: 1, other: 1 });
  });

  it("warnings: ole + charts => preserved, vba => macro, embeddings => preserved", async () => {
    const p = await parsed();
    const inv = inventoryDocxAssets(p, ["word/embeddings/e1.xlsx", "word/vbaProject.bin"]);
    const warnings = unsupportedDocxWarnings(inv);
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("unsupported_construct_preserved");
    expect(codes).toContain("macro_preserved_not_executed");
    expect(warnings.find((w) => w.detail?.includes("OLE"))).toBeDefined();
  });
});

describe("pptx asset inventory", () => {
  it("groups package entries by kind + maps slide media refs", async () => {
    const opened = await createFakePptxEngine().openPptx(makeFakePptxBytes());
    const inv = inventoryPptxAssets(opened);
    expect(inv.media).toEqual(expect.arrayContaining(["ppt/media/image1.png", "ppt/media/image2.svg"]));
    expect(inv.slideLayouts).toContain("ppt/slideLayouts/slideLayout1.xml");
    expect(inv.slideMasters).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(inv.embeddings).toContain("ppt/embeddings/sheet1.xlsx");
    expect(inv.mediaRefs.slide1).toContain("ppt/media/image1.png");
  });

  it("warnings for embeddings/av/vba/fonts surface as typed codes", async () => {
    const opened = await createFakePptxEngine().openPptx(
      makeFakePptxBytes({
        entries: {
          "ppt/media/m.mp4": "V",
          "ppt/embeddings/s.xlsx": "E",
          "ppt/vbaProject.bin": "V",
          "ppt/fonts/f1.fntdata": "F",
        },
      }),
    );
    const warnings = unsupportedPptxWarnings(inventoryPptxAssets(opened));
    const codes = warnings.map((w) => w.code);
    expect(codes).toContain("unsupported_construct_preserved");
    expect(codes).toContain("macro_preserved_not_executed");
    expect(codes).toContain("fonts_substituted");
  });
});

describe("asset diffs (two-save oracle)", () => {
  it("docx diff catches a dropped part and an added one", () => {
    const diff = diffDocxAssets(["a.png", "b.xlsx"], ["a.png", "c.png"]);
    expect(diff.missing).toEqual(["b.xlsx"]);
    expect(diff.added).toEqual(["c.png"]);
  });

  it("pptx inventory diff: same package => empty diff", async () => {
    const opened = await createFakePptxEngine().openPptx(makeFakePptxBytes());
    const inv = inventoryPptxAssets(opened);
    const diff = diffPptxAssets(inv, inv);
    expect(diff.missing).toEqual([]);
    expect(diff.added).toEqual([]);
  });
});

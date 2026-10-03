// UNI-924 A6: heading outline extraction and nesting for the navigation pane.
import { describe, expect, it } from "vitest";
import { docxOutlineFromDoc, type DocxOutlineDocNode } from "./headings-outline";

interface FakeBlock {
  name: string;
  text?: string;
  attrs?: Record<string, unknown>;
}

/** A ProseMirror-shaped fake: top-level blocks, offsets of 10 per block. */
function fakeDoc(blocks: FakeBlock[]): DocxOutlineDocNode {
  const nodes: DocxOutlineDocNode[] = blocks.map((block) => ({
    type: { name: block.name },
    textContent: block.text ?? "",
    attrs: block.attrs,
    forEach: () => {},
  }));
  return {
    type: { name: "doc" },
    textContent: blocks.map((block) => block.text ?? "").join(""),
    forEach(callback) {
      nodes.forEach((node, index) => callback(node, index * 10));
    },
  };
}

describe("docxOutlineFromDoc", () => {
  it("extracts headings in document order and nests by level", () => {
    const outline = docxOutlineFromDoc(
      fakeDoc([
        { name: "docHeading", text: "One", attrs: { level: 1 } },
        { name: "docParagraph", text: "body" },
        { name: "docHeading", text: "One A", attrs: { level: 2 } },
        { name: "docHeading", text: "One B", attrs: { level: 2 } },
        { name: "docHeading", text: "Two", attrs: { level: 1 } },
      ]),
    );

    expect(outline.map((item) => item.text)).toEqual(["One", "Two"]);
    expect(outline[0]?.children.map((item) => item.text)).toEqual(["One A", "One B"]);
    expect(outline[0]?.children[0]?.level).toBe(2);
    expect(outline[0]?.pos).toBe(0);
    expect(outline[0]?.id).toBe("heading-0");
    expect(outline[1]?.pos).toBe(40);
  });

  it("nests a level skip under the nearest shallower heading", () => {
    const outline = docxOutlineFromDoc(
      fakeDoc([
        { name: "docHeading", text: "One", attrs: { level: 1 } },
        { name: "docHeading", text: "Deep", attrs: { level: 3 } },
      ]),
    );
    expect(outline[0]?.children[0]?.text).toBe("Deep");
    expect(outline[0]?.children[0]?.level).toBe(3);
  });

  it("clamps out-of-range levels into 1..9 and defaults junk to 1", () => {
    const outline = docxOutlineFromDoc(
      fakeDoc([
        { name: "docHeading", text: "Zero", attrs: { level: 0 } },
        { name: "docHeading", text: "Twelve", attrs: { level: 12 } },
      ]),
    );
    expect(outline[0]?.level).toBe(1);
    expect(outline[0]?.children[0]?.level).toBe(9);

    const defaults = docxOutlineFromDoc(
      fakeDoc([
        { name: "docHeading", text: "Default" },
        { name: "docHeading", text: "Junk", attrs: { level: "abc" } },
      ]),
    );
    expect(defaults.map((item) => item.level)).toEqual([1, 1]);
  });

  it("skips empty headings and non-headings, and returns [] for an empty or missing doc", () => {
    expect(
      docxOutlineFromDoc(
        fakeDoc([
          { name: "docParagraph", text: "plain" },
          { name: "docHeading", text: "   ", attrs: { level: 1 } },
        ]),
      ),
    ).toEqual([]);
    expect(docxOutlineFromDoc(fakeDoc([]))).toEqual([]);
    expect(docxOutlineFromDoc(null)).toEqual([]);
    expect(docxOutlineFromDoc(undefined)).toEqual([]);
  });
});

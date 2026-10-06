import { describe, expect, it } from "vitest";
import { run, shapeNode, slide, textLayout } from "../canvas/pptx-render-fixtures";
import { collectTextTargets, guardCommitText, paragraphsFromText, textFromLayout, textFromParagraphs } from "./text-model";

describe("paragraphsFromText / textFromParagraphs", () => {
  it("round-trips plain text through one run per paragraph", () => {
    const paragraphs = paragraphsFromText("Title line\nSecond line");
    expect(paragraphs).toEqual([
      { runs: [{ text: "Title line" }] },
      { runs: [{ text: "Second line" }] },
    ]);
    expect(textFromParagraphs(paragraphs)).toBe("Title line\nSecond line");
  });

  it("carries no font overrides, so the engine keeps the element's run properties", () => {
    for (const paragraph of paragraphsFromText("Keep my font")) {
      expect(Object.keys(paragraph)).toEqual(["runs"]);
      expect(Object.keys(paragraph.runs![0]!)).toEqual(["text"]);
    }
  });

  it("normalises CRLF and keeps empty paragraphs", () => {
    expect(paragraphsFromText("a\r\nb\rc")).toHaveLength(3);
    expect(paragraphsFromText("a\n\nb")[1]).toEqual({ runs: [{ text: "" }] });
  });
});

describe("guardCommitText", () => {
  it("refuses an empty or whitespace-only commit so the caller keeps the original", () => {
    expect(guardCommitText("")).toBeNull();
    expect(guardCommitText("   ")).toBeNull();
    expect(guardCommitText("\n\t ")).toBeNull();
  });

  it("accepts real text, preserving inner whitespace", () => {
    expect(guardCommitText("  Edited title  ")).toEqual([{ runs: [{ text: "  Edited title  " }] }]);
  });
});

describe("textFromLayout", () => {
  it("joins soft-wrapped lines and starts a new paragraph at paraStart", () => {
    const layout = textLayout({
      lines: [
        { runs: [run({ text: "Wrapped " })], top: 0, height: 24, paraStart: true },
        { runs: [run({ text: "same paragraph" })], top: 24, height: 24 },
        { runs: [run({ text: "New paragraph" })], top: 48, height: 24, paraStart: true },
      ],
    });
    expect(textFromLayout(layout)).toBe("Wrapped same paragraph\nNew paragraph");
  });

  it("skips bullet markers, which are paint-time decorations", () => {
    const layout = textLayout({ lines: [{ runs: [run({ text: "•", isBullet: true }), run({ text: "Item" })], top: 0, height: 24 }] });
    expect(textFromLayout(layout)).toBe("Item");
  });
});

describe("collectTextTargets", () => {
  it("returns absolute page boxes for text elements, flattened out of groups", () => {
    const targets = collectTextTargets(
      slide([
        shapeNode({ sourceId: "title", box: { x: 40, y: 30, w: 200, h: 60, rotationDeg: 0, flipH: false, flipV: false, centerX: 140, centerY: 60 }, text: textLayout({ lines: [{ runs: [run({ text: "Hello" })], top: 0, height: 24, paraStart: true }] }) }),
      ]),
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ sourceId: "title", box: { x: 40, y: 30, w: 200, h: 60 }, text: "Hello", fontSizePx: 24 });
  });

  it("skips shapes with no text and background/decoration chrome", () => {
    const targets = collectTextTargets(slide([shapeNode({ sourceId: "plain" }), shapeNode({ sourceId: "bg", background: true, text: textLayout() })]));
    expect(targets).toEqual([]);
  });
});
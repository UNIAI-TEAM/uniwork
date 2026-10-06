import { describe, expect, it } from "vitest";
import { applyOp, openFixture, type OpenFixture } from "../ops/test-fixture";
import { elementByPath, HtmlOpError, type HtmlOpContext } from "../ops";
import { colourEdit, deleteEdit, duplicateEdit, fontSizeEdit, inlineDeclaration, isDocumentStructure, toggleMarkEdit } from "./actions";

const SOURCE = `<main><p style="font-weight:700;font-size:20px">Hi</p><p>Two</p></main>`;
const P1 = "main:nth-of-type(1) > p:nth-of-type(1)";
const P2 = "main:nth-of-type(1) > p:nth-of-type(2)";

const ctx = (f: OpenFixture): HtmlOpContext => ({ text: f.text, map: f.map, version: f.version });
const sid = (f: OpenFixture, path: string) => elementByPath(f.map, path)!.sid;

describe("float toolbar edits", () => {
  it("bold turns on when absent and off when already on", async () => {
    const f = await openFixture(SOURCE);
    expect(applyOp(f, toggleMarkEdit(sid(f, P2), "font-weight", "700")(ctx(f))!)).toContain(`<p style="font-weight:700">Two</p>`);
    const g = await openFixture(SOURCE);
    expect(applyOp(g, toggleMarkEdit(sid(g, P1), "font-weight", "700")(ctx(g))!)).toContain(`<p style="font-size:20px">Hi</p>`);
  });

  it("italic sets font-style", async () => {
    const f = await openFixture(SOURCE);
    expect(applyOp(f, toggleMarkEdit(sid(f, P2), "font-style", "italic")(ctx(f))!)).toContain("font-style:italic");
  });

  it("font size steps from the inline size, or from 16px when there is none", async () => {
    const f = await openFixture(SOURCE);
    expect(applyOp(f, fontSizeEdit(sid(f, P1), 1)(ctx(f))!)).toContain("font-size:22px");
    const g = await openFixture(SOURCE);
    expect(applyOp(g, fontSizeEdit(sid(g, P2), -1)(ctx(g))!)).toContain("font-size:14px");
  });

  it("colour sets color; null drops it", async () => {
    const f = await openFixture(SOURCE);
    expect(applyOp(f, colourEdit(sid(f, P2), "#dc2626")(ctx(f))!)).toContain("color:#dc2626");
    const g = await openFixture(`<p style="color:red;margin:0">x</p>`);
    expect(applyOp(g, colourEdit(sid(g, "p:nth-of-type(1)"), null)(ctx(g))!)).toContain(`<p style="margin:0">x</p>`);
  });

  it("delete removes the element's whole range", async () => {
    const f = await openFixture(SOURCE);
    expect(applyOp(f, deleteEdit(sid(f, P2))(ctx(f))!)).toBe(`<main><p style="font-weight:700;font-size:20px">Hi</p></main>`);
  });

  it("duplicate inserts an exact copy right after the element", async () => {
    const f = await openFixture(SOURCE);
    expect(applyOp(f, duplicateEdit(sid(f, P2))(ctx(f))!)).toBe(`<main><p style="font-weight:700;font-size:20px">Hi</p><p>Two</p><p>Two</p></main>`);
  });

  it("an element that no longer exists is an op error or no edit, never a crash", async () => {
    const f = await openFixture(SOURCE);
    expect(() => deleteEdit(99999)(ctx(f))).toThrow(HtmlOpError);
    expect(duplicateEdit(99999)(ctx(f))).toBeNull();
    expect(inlineDeclaration(ctx(f), 99999, "color")).toBeUndefined();
  });
});

describe("html, head and body are not deleted or duplicated", () => {
  it("both builders return null and isDocumentStructure names them", async () => {
    const f = await openFixture("<html><head><title>T</title></head><body><p>x</p></body></html>");
    const context = { text: f.text, map: f.map, version: f.version };
    for (const path of ["html", "html > head", "html > body"]) {
      const sid = elementByPath(f.map, path)!.sid;
      expect(isDocumentStructure(context, sid), path).toBe(true);
      expect(deleteEdit(sid)(context), path).toBeNull();
      expect(duplicateEdit(sid)(context), path).toBeNull();
    }
    const p = elementByPath(f.map, "html > body > p:nth-of-type(1)")!.sid;
    expect(isDocumentStructure(context, p)).toBe(false);
    expect(deleteEdit(p)(context)).not.toBeNull();
  });
});

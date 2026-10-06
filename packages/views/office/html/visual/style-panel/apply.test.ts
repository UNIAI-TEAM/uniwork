import { describe, expect, it } from "vitest";
import { applyOp, openFixture, type OpenFixture } from "../ops/test-fixture";
import { elementByPath, type HtmlOpContext } from "../ops";
import { readStyleValues, stylePatchEdits, styleRevertEdit } from "./apply";

const SOURCE = `<main><p style="color:red;font-weight:700;opacity:0.5">Hi</p><img src="a.png" alt="Anh" style="width:120px;object-fit:cover"><p>Two</p></main>`;
const P1 = "main:nth-of-type(1) > p:nth-of-type(1)";
const IMG = "main:nth-of-type(1) > img:nth-of-type(1)";
const P2 = "main:nth-of-type(1) > p:nth-of-type(2)";

const ctx = (f: OpenFixture): HtmlOpContext => ({ text: f.text, map: f.map, version: f.version });
const sid = (f: OpenFixture, path: string) => elementByPath(f.map, path)!.sid;

describe("stylePatchEdits", () => {
  it("typography becomes one set_style op that keeps the author's other properties", async () => {
    const f = await openFixture(SOURCE);
    const edits = stylePatchEdits(sid(f, P1), { typography: { fontFamily: "Times New Roman", textAlign: "center", fontWeight: null } });
    expect(edits).toHaveLength(1);
    const after = applyOp(f, edits[0]!(ctx(f))!);
    expect(after).toContain("color:red;opacity:0.5;font-family:");
    expect(after).toContain("Times New Roman");
    expect(after).toContain("text-align:center");
    expect(after).not.toContain("font-weight");
  });

  it("size, background and opacity map to px / hex / a 0-1 fraction; 100% drops opacity", async () => {
    const f = await openFixture(SOURCE);
    const [edit] = stylePatchEdits(sid(f, P1), { size: { width: 300.4 }, background: "#ABC", opacity: 100 });
    const after = applyOp(f, edit!(ctx(f))!);
    expect(after).toContain("width:300px");
    expect(after).toContain("background-color:#aabbcc");
    expect(after).not.toContain("opacity");
  });

  it("alt is a separate attribute op", async () => {
    const f = await openFixture(SOURCE);
    const edits = stylePatchEdits(sid(f, IMG), { alt: "Mo ta", fit: "contain" });
    expect(edits).toHaveLength(2);
    expect(applyOp(f, edits[0]!(ctx(f))!)).toContain("object-fit:contain");
    // The second edit is built from a fresh context in real use; here it runs
    // against the unedited fixture on its own.
    const g = await openFixture(SOURCE);
    const [altOnly] = stylePatchEdits(sid(g, IMG), { alt: "Mo ta" });
    expect(applyOp(g, altOnly!(ctx(g))!)).toContain('alt="Mo ta"');
  });

  it("clearing alt on an element without one is no edit, not an error", async () => {
    const f = await openFixture(SOURCE);
    const [edit] = stylePatchEdits(sid(f, P2), { alt: null });
    expect(edit!(ctx(f))).toBeNull();
  });

  it("custom CSS is applied declaration by declaration", async () => {
    const f = await openFixture(SOURCE);
    const [edit] = stylePatchEdits(sid(f, P2), { customCss: "color: green; letter-spacing: 2px" });
    expect(applyOp(f, edit!(ctx(f))!)).toContain(`<p style="color: green;letter-spacing: 2px">Two</p>`);
  });

  it("custom CSS with a URL or a rule block throws instead of reaching the document", async () => {
    const f = await openFixture(SOURCE);
    for (const css of ["background: url(https://x.test/a.png)", "} body { display:none", "a:b;c"]) {
      const [edit] = stylePatchEdits(sid(f, P2), { customCss: css });
      expect(() => edit!(ctx(f)), css).toThrow();
    }
  });

  it("an empty patch has no edits", () => {
    expect(stylePatchEdits(1, {})).toEqual([]);
  });
});

describe("styleRevertEdit", () => {
  it("drops only the properties the panel manages", async () => {
    const f = await openFixture(SOURCE);
    const after = applyOp(f, styleRevertEdit(sid(f, P1))(ctx(f))!);
    expect(after).toContain(`<p style="color:red">Hi</p>`);
  });

  it("is no edit on an element with no style", async () => {
    const f = await openFixture(SOURCE);
    expect(styleRevertEdit(sid(f, P2))(ctx(f))).toBeNull();
  });
});

describe("readStyleValues", () => {
  it("reads the inline style and alt the element carries", async () => {
    const f = await openFixture(SOURCE);
    const p = readStyleValues(ctx(f), sid(f, P1));
    expect(p.fontWeight).toBe(700);
    expect(p.opacity).toBe(50);
    const img = readStyleValues(ctx(f), sid(f, IMG));
    expect(img.alt).toBe("Anh");
    expect(img.size.width).toBe(120);
    expect(img.fit).toBe("cover");
  });

  it("an unknown sid reads as defaults", async () => {
    const f = await openFixture(SOURCE);
    expect(readStyleValues(ctx(f), 99999).opacity).toBe(100);
  });
});

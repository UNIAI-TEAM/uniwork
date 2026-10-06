import { describe, expect, it } from "vitest";
import { applyOp, expectByteIdentical, openFixture } from "./test-fixture";
import { elementByPath, HtmlOpError, setStyleDeclarations, type HtmlOpContext } from "./index";

const SOURCE = `<main><p class="a" style="color:red;margin:0">Hi</p><p>Two</p></main>`;
const P1 = "main:nth-of-type(1) > p:nth-of-type(1)";
const P2 = "main:nth-of-type(1) > p:nth-of-type(2)";

async function open() {
  const f = await openFixture(SOURCE);
  const context: HtmlOpContext = { text: f.text, map: f.map, version: f.version };
  return { f, context };
}

describe("setStyleDeclarations", () => {
  it("replaces only the named properties of an existing style attribute", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P1)!;
    const set = setStyleDeclarations(context, { sid: p.sid }, ["color:blue", "font-weight:700"]);
    expect(set.label).toBe("set_style");
    const after = applyOp(f, set);
    expect(after).toBe(`<main><p class="a" style="margin:0;color:blue;font-weight:700">Hi</p><p>Two</p></main>`);
  });

  it("adds a style attribute where none exists, leaving the rest byte-identical", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P2)!;
    const set = setStyleDeclarations(context, { sid: p.sid }, ["opacity:0.5"]);
    const after = applyOp(f, set);
    expectByteIdentical(SOURCE, after, [{ from: p.startTag[1] - 1, to: p.startTag[1] - 1, text: ' style="opacity:0.5"' }], "set_style");
  });

  it("drops a property by name", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P1)!;
    const after = applyOp(f, setStyleDeclarations(context, { sid: p.sid }, [], ["color"]));
    expect(after).toContain('style="margin:0"');
  });

  it("refuses a declaration that would smuggle a second property, a rule or a URL", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P1)!;
    for (const bad of ["color:red;position:fixed", "color:red}body{x:y", "background:url(https://x.test/a.png)", "width:expression(alert(1))", "color", "1x:red", "a:b<c"]) {
      expect(() => setStyleDeclarations(context, { sid: p.sid }, [bad]), bad).toThrow(HtmlOpError);
    }
  });

  it("an empty request is a no_op", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P2)!;
    expect(() => setStyleDeclarations(context, { sid: p.sid }, [])).toThrow(HtmlOpError);
  });
});

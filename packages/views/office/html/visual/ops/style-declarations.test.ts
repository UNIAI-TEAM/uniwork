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

  it("refuses every URL-bearing function, not only url(", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P1)!;
    for (const bad of [
      'background-image:image-set("https://e.example/x.png" 1x)',
      'background-image:-webkit-image-set("https://e.example/x.png" 1x)',
      'background:src("https://e.example/x.png")',
      'background:image("https://e.example/x.png")',
      "mask-image:image-set('https://e.example/x.png' 1x)",
      'border-image-source:image-set("https://e.example/x.png" 1x)',
      'cursor:image-set("https://e.example/x.png" 1x), auto',
      'background-image:cross-fade(url(a.png), url(b.png))',
      'background-image:element(#x)',
      'background-image:paint(foo)',
      'content:"https://e.example/x.png"',
      'background:linear-gradient(red, blue), "x"',
    ]) {
      expect(() => setStyleDeclarations(context, { sid: p.sid }, [bad]), bad).toThrow(HtmlOpError);
    }
  });

  it("refuses CSS escapes, comments and newlines that hide a function or swallow what follows", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P1)!;
    for (const bad of [
      "background:\\75rl(a.png)",
      "background:u/**/rl(a.png)",
      "color:red/*",
      "color:red /* x */",
      'font-family:"Foo',
      "font-family:'Foo",
      "width:calc(",
      "width:calc(1px + (2px)",
      "width:1px)",
      "color:red\nbackground:blue",
      "color:red\rbackground:blue",
      "color:red\u2028x",
      "color:re\u0000d",
    ]) {
      expect(() => setStyleDeclarations(context, { sid: p.sid }, [bad]), JSON.stringify(bad)).toThrow(HtmlOpError);
    }
  });

  it("keeps the values the panel and ordinary CSS need", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P2)!;
    for (const good of [
      'font-family:"Be Vietnam Pro", sans-serif',
      "font-family:'Open Sans',Arial",
      "color:rgb(10 20 30 / 50%)",
      "background-color:#2563eb",
      "width:calc(100% - (2 * var(--gap, 4px)))",
      "background-image:linear-gradient(to right, red 0%, hsla(0, 0%, 0%, .5))",
      "transform:translate(-50%, 10px) rotate(3deg)",
      "opacity:0.5",
    ]) {
      expect(() => setStyleDeclarations(context, { sid: p.sid }, [good]), good).not.toThrow();
    }
  });

  it("an empty request is a no_op", async () => {
    const { f, context } = await open();
    const p = elementByPath(f.map, P2)!;
    expect(() => setStyleDeclarations(context, { sid: p.sid }, [])).toThrow(HtmlOpError);
  });
});

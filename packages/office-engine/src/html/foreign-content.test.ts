import { describe, expect, it } from "vitest";
import { createForeignContentTracker } from "./foreign-content";
import { scanHtmlSlots } from "./references";

// Each case is "markup before" + a <style> holding a link. "live" means the
// HTML parser builds a real <a> there (the preview copy must rewrite it);
// "raw" means the parser reads the <style> body as CSS text.
const LINK = `<style><a href="https://evil.example/x">x</a></style>`;
const roles = (html: string) => scanHtmlSlots(html + LINK).map((s) => s.role + ":" + s.kind);
const LIVE = ["navigation:url"];
const RAW = ["image:css"];

describe("foreign content, as the HTML tree builder sees it", () => {
  it.each([
    // FE review r3 R3-1: a breakout inside a nested svg pops only to the integration point.
    ["breakout inside foreignObject > svg", `<svg><foreignObject><svg><p></p></foreignObject>`],
    // Start tags take the CURRENT namespace: these are not integration points.
    ["svg foreignObject under math", `<math><svg><foreignObject>`],
    ["mi under svg", `<svg><math><mi>`],
    // With an HTML element open inside the integration point, </svg> is ignored
    // and </foreignObject> returns to svg.
    ["</svg> ignored while a div is open in foreignObject", `<svg><foreignObject><div></svg></div></foreignObject>`],
    ["annotation-xml without HTML encoding", `<math><annotation-xml>`],
    ["svg title body is markup", `<svg><title><a href="https://evil.example/t">t</a></title></svg><svg>`],
    ["unquoted value ending in slash", `<svg x=1/>`],
    ["same-name nested root closes only itself", `<svg><svg></svg>`],
  ])("keeps %s in foreign content (link is live)", (_name, before) => {
    expect(roles(before).slice(-1)).toEqual(LIVE);
  });

  it.each([
    ["after </svg>", `<svg></svg>`],
    ["self-closing root", `<svg/>`],
    ["breakout start tag", `<svg><div>`],
    ["font breakout", `<svg><font size="2">`],
    ["</p> breakout end tag", `<svg></p>`],
    ["</br> breakout end tag", `<math></br>`],
    ["foreignObject integration point", `<svg><foreignObject>`],
    ["MathML text integration point", `<math><mtext>`],
    ["HTML-encoded annotation-xml", `<math><annotation-xml encoding="text/html">`],
    ["svg opened by HTML rules inside annotation-xml, then its foreignObject", `<math><annotation-xml><svg><foreignObject>`],
    ["closing the last integration point by name", `<svg><desc></desc></svg>`],
  ])("returns to HTML parsing %s (style is raw text)", (_name, before) => {
    expect(roles(before).slice(-1)).toEqual(RAW);
  });

  it("over-scans (never under-scans) where the parser leaves svg earlier than the model", () => {
    // Parser: </svg> at the integration point pops svg and foreignObject, so
    // the <style> is raw text. The model stays inside foreignObject until its
    // own end tag and then treats the <style> as markup - extra rewriting in
    // the preview copy only.
    expect(roles(`<svg><foreignObject></svg></foreignObject>`).slice(-1)).toEqual(LIVE);
  });

  it("tracks directly", () => {
    const t = createForeignContentTracker();
    expect(t.inForeign()).toBe(false);
    t.endTag("svg");
    t.startTag("svg", [], false);
    expect(t.inForeign()).toBe(true);
    t.startTag("rect", [], true);
    t.startTag("g", [], false);
    expect(t.inForeign()).toBe(true);
    t.startTag("foreignobject", [], false);
    expect(t.inForeign()).toBe(false);
    t.endTag("div");
    expect(t.inForeign()).toBe(false);
    t.endTag("foreignobject");
    expect(t.inForeign()).toBe(true);
    t.endTag("nothing-open");
    expect(t.inForeign()).toBe(true);
    t.endTag("svg");
    expect(t.inForeign()).toBe(false);
  });
});

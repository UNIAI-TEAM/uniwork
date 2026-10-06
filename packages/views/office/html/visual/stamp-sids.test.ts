import { describe, expect, it } from "vitest";
import { buildFixtureParseMap } from "./ops/test-fixture";
import { stampSids } from "./stamp-sids";

const SOURCE = `<!doctype html><html><head><title>T</title></head><body><main id="m"><h1 class='t'>Hi</h1><img src="a.png"><p>One <b>two</b></p></main></body></html>`;

describe("stampSids", () => {
  it("puts data-sid right after the tag name of every mapped element", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const stamped = stampSids(SOURCE, map);
    for (const element of map.elements) {
      if (element.startTag[0] === element.startTag[1]) continue;
      expect(stamped).toContain(`<${element.tag} data-sid="${element.sid}"`);
    }
  });

  it("only adds the attribute: removing it gives back the source byte for byte", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    expect(stampSids(SOURCE, map).replace(/ data-sid="\d+"/g, "")).toBe(SOURCE);
  });

  it("leaves an element with no source start tag (implied html/head/body) alone", () => {
    const text = "<p>x</p>";
    const map = buildFixtureParseMap(text, 1);
    const stamped = stampSids(text, map);
    expect(stamped.match(/data-sid=/g)?.length).toBe(1);
  });

  it("ignores a stale map whose ranges fall outside the text", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    expect(stampSids("<p>", map)).toBe("<p>");
  });

  it("an empty map is the identity", () => {
    expect(stampSids(SOURCE, { version: 1, elements: [], bySid: new Map(), errorCount: 0 })).toBe(SOURCE);
  });
});

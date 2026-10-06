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

  describe("a document cannot claim a data-sid (ADR 0027: the stamp is the only source)", () => {
    const stampedOf = (text: string): string => stampSids(text, buildFixtureParseMap(text, 1));

    it("strips a data-sid on an element the map knows, whatever the quoting or case", () => {
      const stamped = stampedOf(`<p data-sid="777" DATA-SID=888 data-sid='999' id="a">x</p>`);
      expect(stamped).not.toMatch(/777|888|999/);
      expect(stamped.match(/data-sid=/gi)).toHaveLength(1);
      expect(stamped).toContain('id="a"');
    });

    it("strips a data-sid on a late <body>/<html> start tag that is not in the map", () => {
      const text = `<p>x</p><body data-sid="777"><html lang="vi" data-sid='888'>`;
      const map = buildFixtureParseMap(text, 1);
      const stamped = stampSids(text, { ...map, elements: map.elements.filter((element) => element.tag === "p") });
      expect(stamped).not.toMatch(/777|888/);
      expect(stamped).toContain('lang="vi"');
      expect(stamped.match(/data-sid=/gi)).toHaveLength(1);
    });

    it("strips the valueless and spaced forms and keeps a quoted '>' in another attribute intact", () => {
      const stamped = stampedOf(`<div title="a>b" data-sid = 777 hidden data-sid>y</div>`);
      expect(stamped).not.toContain("777");
      expect(stamped).toContain('title="a>b"');
      expect(stamped).toContain("hidden");
      expect(stamped.match(/data-sid/gi)).toHaveLength(1);
    });

    it("keeps data-sid text inside another attribute's value", () => {
      const stamped = stampedOf(`<p title='data-sid="5"'>y</p>`);
      expect(stamped).toContain(`title='data-sid="5"'`);
    });
  });
});

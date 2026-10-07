import { describe, expect, it } from "vitest";
import { buildFixtureParseMap } from "./ops/test-fixture";
import { sidAttributeName, stampSids } from "./stamp-sids";

const NONCE = "0123456789abcdef0123456789abcdef";
const ATTR = sidAttributeName(NONCE);
const SOURCE = `<!doctype html><html><head><title>T</title></head><body><main id="m"><h1 class='t'>Hi</h1><img src="a.png"><p>One <b>two</b></p></main></body></html>`;
const EMPTY_MAP = { version: 1, elements: [], bySid: new Map(), errorCount: 0 };
const unstamp = (text: string): string => text.split(` ${ATTR}="`).map((part, index) => (index === 0 ? part : part.replace(/^\d+"/, ""))).join("");

describe("stampSids", () => {
  it("puts the nonce-named attribute right after the tag name of every mapped element", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const stamped = stampSids(SOURCE, map, NONCE);
    for (const element of map.elements) {
      if (element.startTag[0] === element.startTag[1]) continue;
      expect(stamped).toContain(`<${element.tag} ${ATTR}="${element.sid}"`);
    }
  });

  it("only adds the attribute: removing it gives back the source byte for byte", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    expect(unstamp(stampSids(SOURCE, map, NONCE))).toBe(SOURCE);
  });

  it("leaves an element with no source start tag (implied html/head/body) alone", () => {
    const text = "<p>x</p>";
    const stamped = stampSids(text, buildFixtureParseMap(text, 1), NONCE);
    expect(stamped.split(ATTR)).toHaveLength(2);
  });

  it("ignores a stale map whose ranges fall outside the text", () => {
    expect(stampSids("<p>", buildFixtureParseMap(SOURCE, 1), NONCE)).toBe("<p>");
  });

  it("an empty map is the identity", () => {
    expect(stampSids(SOURCE, EMPTY_MAP, NONCE)).toBe(SOURCE);
  });

  it("a malformed nonce stamps nothing (fail closed)", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    for (const bad of ["", "abc", NONCE.toUpperCase(), `${NONCE}0`, `${NONCE.slice(1)}" onload="x`]) {
      expect(stampSids(SOURCE, map, bad)).toBe(SOURCE);
    }
  });

  describe("a document cannot claim a sid (ADR 0027: the stamp is the only source)", () => {
    // Every probe the reviewer ran against the regex strip, plus the tokenizer
    // differentials: a leading `=` in a name, quotes inside comments / textarea
    // / script / title, implied or late html/head/body/tbody, uppercase and
    // entity-encoded names, valueless and spaced forms.
    const HOSTILE = [
      `<p>x</p><body =x data-sid="777">`,
      `<p>x</p><html =x data-sid=888>`,
      `<!-- <p a=" --><p>x</p><body data-sid="777" b=" ">`,
      `<textarea><p a="</textarea><p>x</p><body data-sid="777" b=" ">`,
      `<script>var s = '<p a="';</script><p>x</p><body data-sid="777" b=" ">`,
      `<title><p a="</title><p>x</p><body DATA-SID=777 b=" ">`,
      `<style>p::after{content:"<p a='"}</style><p>x</p><body data-sid=777 c='>`,
      `<p>x</p><body data&#45;sid="777" DATA-SID = 888 data-sid hidden>`,
      `<p>x</p><body\n/data-sid\n=\n"777"/>`,
      `<table><tr><td>a</td></tr></table><tbody data-sid="777"><html lang="vi" data-sid='888'>`,
      `<div title="a>b" data-sid = 777 hidden data-sid>y</div><body data-sid="1">`,
      `<p data-sid="777" DATA-SID=888 data-sid='999' id="a">x</p>`,
    ];
    const carriers = (html: string): Element[] => Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll(`[${ATTR}]`));

    it.each(HOSTILE)("no element carries the session attribute that the stamp did not number: %s", (text) => {
      // With nothing mapped, nothing may carry it - whatever the document wrote.
      expect(carriers(stampSids(text, EMPTY_MAP, NONCE))).toHaveLength(0);
      // With the map, a carrier is a mapped element and holds ITS sid, never a number the document picked.
      const map = buildFixtureParseMap(text, 1);
      const stamped = stampSids(text, map, NONCE);
      const sids = new Set(map.elements.map((element) => element.sid));
      for (const element of carriers(stamped)) {
        const sid = Number(element.getAttribute(ATTR));
        expect(sids.has(sid), `${element.tagName} carries ${sid}`).toBe(true);
        expect(element.tagName.toLowerCase()).toBe(map.bySid.get(sid)!.tag);
      }
    });

    it.each(HOSTILE)("the document's own bytes are untouched (it is stamped, not rewritten): %s", (text) => {
      expect(unstamp(stampSids(text, buildFixtureParseMap(text, 1), NONCE))).toBe(text);
    });

    it("another session's attribute name in the document is inert and left alone", () => {
      const other = sidAttributeName("f".repeat(32));
      const text = `<p ${other}="9">x</p>`;
      const stamped = stampSids(text, buildFixtureParseMap(text, 1), NONCE);
      expect(stamped).toContain(`${other}="9"`);
      expect(carriers(stamped).map((element) => element.getAttribute(ATTR))).toEqual(["1"]);
    });
  });
});

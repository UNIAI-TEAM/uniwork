import { buildHtmlPreviewCopy } from "@uniwork/office-engine/html";
import { describe, expect, it } from "vitest";

// Parser-parity property for the preview copy. The engine rewrites URLs with
// a string scanner; the frame parses the copy with a real HTML tree builder.
// Any disagreement about foreign content (svg/math) can leave a live link or
// image pointing outside (FE reviews r1 F-2, r2 N-1, r3 R3-1). jsdom parses
// with parse5, a spec-conformant tree builder, so: for random markup around
// hostile references, the COPY as parsed must hold no element whose URL
// attribute still points at the hostile origin.

const EVIL = "https://evil.example";
const TOKENS = [
  "<svg>", "</svg>", "<svg/>", "<svg x=1/>", "<math>", "</math>", "<math/>",
  "<foreignObject>", "</foreignObject>", "<desc>", "</desc>", "<title>", "</title>",
  "<mi>", "</mi>", "<mtext>", "</mtext>", "<annotation-xml>", '<annotation-xml encoding="text/html">', "</annotation-xml>",
  "<g>", "</g>", "<p>", "</p>", "<div>", "</div>", "<br>", "</br>", '<font size="1">', "<font>", "</font>",
  "<style>", "</style>", "<textarea>", "</textarea>", "<table>", "<b>", "x",
];
const PAYLOADS = [
  `<a href="${EVIL}/a">a</a>`,
  `<image href="${EVIL}/i.png"/>`,
  `<img src="${EVIL}/p.png">`,
  `<use xlink:href="${EVIL}/u.svg#x"/>`,
];

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const URL_ATTRS = ["href", "src", "xlink:href", "srcset", "poster", "data", "action", "formaction", "background"];

function liveHostile(copy: string): string[] {
  const doc = new DOMParser().parseFromString(copy, "text/html");
  const found: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (URL_ATTRS.includes(attr.name.toLowerCase()) && attr.value.includes("evil.example")) {
        found.push(el.tagName.toLowerCase() + "[" + attr.name + "]");
      }
    }
  }
  return found;
}

const copyOf = (text: string) =>
  buildHtmlPreviewCopy({
    text,
    manifest: { version: 1, document_path: "index.html", entries: [] },
    assetUrl: () => null,
    scripts: false,
    csp: "default-src 'none'",
  });

describe("preview copy parser parity (parse5 tree builder)", () => {
  it("leaves no live hostile URL for 3000 random foreign-content prefixes", () => {
    const next = prng(0x9e3779b9);
    const failures: string[] = [];
    for (let n = 0; n < 3000 && failures.length < 5; n++) {
      const length = 1 + Math.floor(next() * 8);
      let text = "";
      for (let k = 0; k < length; k++) text += TOKENS[Math.floor(next() * TOKENS.length)];
      text += PAYLOADS[Math.floor(next() * PAYLOADS.length)];
      const live = liveHostile(copyOf(text));
      if (live.length > 0) failures.push(JSON.stringify(text) + " -> " + live.join(","));
    }
    expect(failures).toEqual([]);
  });

  it.each([
    `<svg><foreignObject><svg><p></p></foreignObject><style>${PAYLOADS[0]}</style>`,
    `<math><svg><foreignObject><style>${PAYLOADS[0]}</style>`,
    `<svg><math><mi><style>${PAYLOADS[1]}</style>`,
    `<svg><foreignObject><div></svg></div></foreignObject><style>${PAYLOADS[0]}</style>`,
    `<svg x=1/><style>${PAYLOADS[3]}</style>`,
  ])("rewrites the known bypass %s", (text) => {
    expect(liveHostile(text).length).toBeGreaterThan(0);
    expect(liveHostile(copyOf(text))).toEqual([]);
  });
});

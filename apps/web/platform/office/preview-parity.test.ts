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
// Only tokens that can change how a later <style> is parsed.
const TOKENS = [
  "<svg>", "</svg>", "<svg/>", "<svg x=1/>", "<math>", "</math>",
  "<foreignObject>", "</foreignObject>", "<desc>", "</desc>", "<title>", "</title>",
  "<mi>", "</mi>", "<annotation-xml>", '<annotation-xml encoding="text/html">', "</annotation-xml>",
  "<g>", "<p>", "</p>", "<div>", "</div>", "</br>", '<font size="1">', "<font>",
  // Comment and raw-text boundaries as the tokenizer reads them.
  "<!-->", "<!--->", "<!--", "-->", "--!>", "<![CDATA[", "]]>",
  "<style>", '</style x="1">', "</style/>", "<script>", "</script>", "<textarea>", "</textarea>",
  "<iframe>", "</iframe>", "<noscript>", "</noscript>", "<xmp>", "</xmp>",
];
// The payload usually sits in a raw-text element: that is where a
// scanner/parser disagreement hides a live element.
const WRAPPERS: Array<[string, string]> = [["<style>", "</style>"], ["<style>", "</style>"], ["<title>", "</title>"], ["", ""]];
const PAYLOADS = [
  `<a href="${EVIL}/a">a</a>`,
  `<image href="${EVIL}/i.png"/>`,
  `<img src="${EVIL}/p.png">`,
  `<use xlink:href="${EVIL}/u.svg#x"/>`,
  `<a><set attributeName="href" to="${EVIL}/s"/>s</a>`,
  `<meta http-equiv="refresh" content="0;url=${EVIL}/r">`,
  `<iframe srcdoc="&lt;img src=${EVIL}/d.png&gt;"></iframe>`,
  `<a href="#" ping="${EVIL}/p">p</a>`,
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

const URL_ATTRS = ["href", "src", "xlink:href", "srcset", "poster", "data", "action", "formaction", "background", "ping"];

function liveHostile(copy: string): string[] {
  const doc = new DOMParser().parseFromString(copy, "text/html");
  const found: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    // SVG animation can set a link's href without any script.
    const animatesHref = (tag === "set" || tag === "animate") && /href/i.test(el.getAttribute("attributeName") ?? "");
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const hostile = attr.value.includes("evil.example");
      if (hostile && (URL_ATTRS.includes(name) || name === "srcdoc" || (name === "content" && tag === "meta"))) found.push(tag + "[" + name + "]");
      if (hostile && animatesHref && ["to", "from", "by", "values"].includes(name)) found.push(tag + "[" + name + "]");
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
  it("leaves no live hostile URL for 20000 random foreign-content prefixes", () => {
    const next = prng(0x9e3779b9);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
    const failures: string[] = [];
    for (let n = 0; n < 20000 && failures.length < 5; n++) {
      const length = 1 + Math.floor(next() * 7);
      let text = "";
      for (let k = 0; k < length; k++) text += pick(TOKENS);
      const [open, close] = pick(WRAPPERS);
      text += open + pick(PAYLOADS) + close;
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
    `<xmp><!--<mi></xmp></svg><svg><style>${PAYLOADS[2]}</style>`,
    `<svg><a><set attributeName="href" to="${EVIL}/s"/>s</a></svg>`,
    `<!-- <b title="--> <a href=${EVIL}/c> ">`,
    `<svg><![CDATA[ x > <!--]]><image href="#"xlink:href="${EVIL}/q.png"/></svg>`,
    // FE review r4 R4-1: a phantom match inside a quoted value swallowing real attributes.
    `<svg><a><set title="q href="#y attributeName=href to=${EVIL}/s "/>s</a></svg>`,
    `<img src="data:image/png;base64,x attributeName=href to=${EVIL}/s"><svg><a><set title="q src="data:image/png;base64,x attributeName=href to=${EVIL}/s "/>s</a></svg>`,
    `<a title="x href='z' y" href="#" ping="${EVIL}/p">p</a>`,
    `<svg><foreignObject></svg></foreignObject><style><img src="data:image/png,</style><a href=${EVIL}/k>">`,
  ])("rewrites the known bypass %s", (text) => {
    expect(liveHostile(text).length).toBeGreaterThan(0);
    expect(liveHostile(copyOf(text))).toEqual([]);
  });
});

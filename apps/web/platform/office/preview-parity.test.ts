import { buildHtmlPreviewCopy } from "@uniwork/office-engine/html";
import { describe, expect, it } from "vitest";
import { gatePreviewCopy } from "./preview-gate";

// Parser-parity property for the preview. jsdom parses with parse5, a
// spec-conformant tree builder. Every gate check runs under BOTH scripting
// flags: DOMParser parses with scripting off (as the gate does), while the
// frame may run with scripts on, where <noscript> bodies are raw text. The
// hostile check: no element of the parsed result may still carry a URL,
// srcdoc, refresh or href animation pointing at the hostile origin.
//
// Seeds are fixed and printed in any failure, so a failing case replays.

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
  `<object data="${EVIL}/o.svg"></object>`,
  `<form action="${EVIL}/f"><button>b</button></form>`,
];
const FUZZ_SEED = 0x2545f491;
const COPY_FUZZ_SEED = 0x9e3779b9;
const URL_ATTRS = ["href", "src", "xlink:href", "srcset", "imagesrcset", "poster", "data", "action", "formaction", "background", "ping"];

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

function hostileIn(root: ParentNode): string[] {
  const found: string[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    // SVG animation can set a link's href without any script.
    const animatesHref = (tag === "set" || tag === "animate") && /href/i.test(el.getAttribute("attributeName") ?? "");
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // A data URL on a link or reference opens a document outside the proxy.
      const embedded = ["src", "srcset", "poster", "background"].includes(name) || ((tag === "image" || tag === "feimage") && name.endsWith("href"));
      if (/^\s*data:/i.test(attr.value) && !embedded && URL_ATTRS.includes(name)) {
        found.push(tag + "[" + name + "]=data");
        continue;
      }
      // An embedded image/font data URL is inert bytes, whatever text it carries.
      if (!attr.value.includes("evil.example") || /^\s*data:(?:image|font)\//i.test(attr.value)) continue;
      if (URL_ATTRS.includes(name) || name === "srcdoc" || (name === "content" && tag === "meta")) found.push(tag + "[" + name + "]");
      if (animatesHref && ["to", "from", "by", "values"].includes(name)) found.push(tag + "[" + name + "]");
    }
  }
  return found;
}

/** Live hostile elements with scripting off (DOMParser) and on (fragment
 * parsing in the test document, which runs with scripting enabled). */
function liveHostile(html: string): string[] {
  const off = hostileIn(new DOMParser().parseFromString(html, "text/html")).map((h) => "off:" + h);
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const on = hostileIn(holder).map((h) => "on:" + h);
  return [...off, ...on];
}

const copyOf = (text: string) =>
  buildHtmlPreviewCopy({
    text,
    manifest: { version: 1, document_path: "index.html", entries: [] },
    assetUrl: () => null,
    scripts: false,
    csp: "default-src 'none'",
  });

/** The gate by itself: raw hostile text in - no engine copy, no engine sweep. */
const gateOnly = (text: string): string => {
  const result = gatePreviewCopy(text, { assetOrigin: "https://preview-assets.example", blockedUrl: "about:blank#blocked" });
  return result.ok ? result.html : "";
};

function randomCases(count: number, seed: number): string[] {
  const next = prng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const out: string[] = [];
  for (let n = 0; n < count; n++) {
    const length = 1 + Math.floor(next() * 7);
    let text = "";
    for (let k = 0; k < length; k++) text += pick(TOKENS);
    const [open, close] = pick(WRAPPERS);
    out.push(text + open + pick(PAYLOADS) + close);
  }
  return out;
}

function fuzzFailures(count: number, seed: number, check: (text: string) => string[]): string[] {
  const failures: string[] = [];
  randomCases(count, seed).forEach((text, index) => {
    if (failures.length >= 5) return;
    const live = check(text);
    if (live.length > 0) failures.push("seed 0x" + seed.toString(16) + " case " + index + ": " + JSON.stringify(text) + " -> " + live.join(","));
  });
  return failures;
}

/** Every bypass found in review or by fuzzing, each live in the raw text. */
const KNOWN_BYPASSES: ReadonlyArray<readonly [string, string]> = [
  ["R3-1 breakout in nested svg", `<svg><foreignObject><svg><p></p></foreignObject><style>${PAYLOADS[0]}</style>`],
  ["svg under math", `<math><svg><foreignObject><style>${PAYLOADS[0]}</style>`],
  ["mi under svg", `<svg><math><mi><style>${PAYLOADS[1]}</style>`],
  ["</svg> with a div open", `<svg><foreignObject><div></svg></div></foreignObject><style>${PAYLOADS[0]}</style>`],
  ["unquoted slash (N-1)", `<svg x=1/><style>${PAYLOADS[3]}</style>`],
  ["comment inside xmp", `<xmp><!--<mi></xmp></svg><svg><style>${PAYLOADS[2]}</style>`],
  ["smil href", `<svg><a><set attributeName="href" to="${EVIL}/s"/>s</a></svg>`],
  ["tag inside a comment", `<!-- <b title="--> <a href=${EVIL}/c> ">`],
  ["cdata, adjacent attributes", `<svg><![CDATA[ x > <!--]]><image href="#"xlink:href="${EVIL}/q.png"/></svg>`],
  ["markup in a value over a raw style", `<svg><foreignObject></svg></foreignObject><style><img src="data:image/png,</style><a href=${EVIL}/k>">`],
  ["ping", `<a title="x href='z' y" href="#" ping="${EVIL}/p">p</a>`],
  // FE review r4 R4-1: a match inside a quoted value swallowing real attributes.
  ["R4-1 fragment swallow", `<svg><a><set title="q href="#y attributeName=href to=${EVIL}/s "/>s</a></svg>`],
  [
    "R4-1 approved-value swallow",
    `<img src="data:image/png;base64,x attributeName=href to=${EVIL}/s"><svg><a><set title="q src="data:image/png;base64,x attributeName=href to=${EVIL}/s "/>s</a></svg>`,
  ],
  // FE review r5 R5-1: data: documents behind links and references.
  ["R5-1 data link", `<a href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E">d</a>`],
  ["R5-1 data svg link", `<svg><a href="data:image/svg+xml,%3Csvg%2F%3E"><text>d</text></a><use href="data:image/svg+xml,%3Csvg%2F%3E#x"/></svg>`],
  // Scripting-flag difference: inert for DOMParser, live in a scripts-on frame.
  ["noscript breakout", `<noscript><p title="</noscript><a href=${EVIL}/n>n</a>"></p></noscript>`],
];

// The two seeded fuzz runs keep their full counts; they get their own budget
// instead of the suite-wide testTimeout.
const FUZZ_TIMEOUT_MS = 240_000;

describe("final gate alone (no engine copy, no engine sweep)", () => {
  it.each(KNOWN_BYPASSES)("blocks the known bypass: %s", (_name, text) => {
    expect(liveHostile(text).length).toBeGreaterThan(0);
    expect(liveHostile(gateOnly(text))).toEqual([]);
  });

  // Seeded fuzz, heavy on purpose: ~23 s locally, past the 60 s default on a CI runner.
  it("leaves no live hostile URL for 5000 raw random documents, both scripting flags", () => {
    expect(fuzzFailures(5000, FUZZ_SEED, (text) => liveHostile(gateOnly(text)))).toEqual([]);
  }, FUZZ_TIMEOUT_MS);
});

describe("full preview pipeline: engine copy, then the gate", () => {
  it.each(KNOWN_BYPASSES)("blocks the known bypass: %s", (_name, text) => {
    expect(liveHostile(gateOnly(copyOf(text)))).toEqual([]);
  });
});

describe("engine copy alone (defence in depth under the gate, scripting off)", () => {
  const offOnly = (html: string) => hostileIn(new DOMParser().parseFromString(html, "text/html"));

  it("leaves no live hostile URL for 20000 random foreign-content prefixes", () => {
    expect(fuzzFailures(20000, COPY_FUZZ_SEED, (text) => offOnly(copyOf(text)))).toEqual([]);
  }, FUZZ_TIMEOUT_MS);

  // Excluded: the scripting-flag case (the engine does not parse), and data:
  // on SVG <use> - the engine has no element-level data rule; the gate owns it.
  const engineScope = KNOWN_BYPASSES.filter(([name]) => name !== "noscript breakout" && name !== "R5-1 data svg link");
  it.each(engineScope)("rewrites the known bypass: %s", (_name, text) => {
    expect(offOnly(copyOf(text))).toEqual([]);
  });
});

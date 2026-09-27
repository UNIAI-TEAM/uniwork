import { afterEach, describe, expect, it, vi } from "vitest";
import { gatePreviewCopy, type GateResult } from "./preview-gate";

const PROXY = "https://preview-assets.example";
const OPTIONS = { assetOrigin: PROXY, blockedUrl: "about:blank#blocked" };
const EVIL = "https://evil.example";

function gate(html: string): Extract<GateResult, { ok: true }> {
  const result = gatePreviewCopy(html, OPTIONS);
  if (!result.ok) throw new Error("gate refused: " + result.reason);
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe("preview gate (browser parser tree walk)", () => {
  it.each([
    ["a link", `<a href="${EVIL}/a">a</a>`],
    ["an svg xlink:href", `<svg><a xlink:href="${EVIL}/x"><text>x</text></a></svg>`],
    ["an image source", `<img src="${EVIL}/i.png">`],
    ["a srcset candidate", `<img srcset="${PROXY}/ok.png 1x, ${EVIL}/i.png 2x">`],
    ["a link imagesrcset", `<link rel="preload" as="image" imagesrcset="${EVIL}/i.png 1x">`],
    ["a hyperlink ping", `<a href="#" ping="${EVIL}/p">p</a>`],
    ["a form action", `<form action="${EVIL}/f"><button formaction="${EVIL}/b">b</button></form>`],
    ["an object data", `<object data="${EVIL}/o.svg"></object>`],
    ["a relative URL", `<a href="other.html">o</a>`],
    ["a javascript URL", `<a href="javascript:alert(1)">j</a>`],
    ["an html data URL", `<iframe src="data:text/html,x"></iframe>`],
  ])("drops %s", (_name, html) => {
    const out = gate(html).html;
    expect(out).not.toContain("evil.example");
    expect(out).not.toMatch(/other\.html|javascript:|data:text/);
  });

  it("removes <base>, meta refresh, srcdoc and SVG animations that retarget href", () => {
    const out = gate(
      `<base href="${EVIL}/"><meta http-equiv="Refresh" content="0;url=${EVIL}/r"><meta http-equiv="refresh"><meta content="url=${EVIL}/u">` +
        `<iframe srcdoc="<img src=x>"></iframe><svg><a><set attributeName="HREF" to="${EVIL}/s"/>` +
        `<animate attributeName="xlink:href" values="${EVIL}/v"/></a></svg><meta name="viewport" content="width=device-width">`,
    ).html;
    expect(out).not.toContain("evil.example");
    expect(out).not.toMatch(/<base|srcdoc="<|<set|<animate|http-equiv/i);
    expect(out).toContain(`<meta name="viewport" content="width=device-width">`);
  });

  it("drops loader elements and noscript whole, even with safe-looking values", () => {
    const out = gate(
      `<object data="${PROXY}/s/o.svg"></object><embed src="${PROXY}/s/e.svg"><iframe src="about:blank"></iframe>` +
        `<frameset></frameset><portal src="${PROXY}/s/p"></portal><noscript><p>n</p></noscript><p>kept</p>`,
    ).html;
    expect(out).not.toMatch(/<object|<embed|<iframe|<frameset|<portal|<noscript/i);
    expect(out).toContain("<p>kept</p>");
  });

  it("allows a URL attribute only on the elements that carry it", () => {
    const out = gate(
      `<div href="${PROXY}/s/a.png" src="${PROXY}/s/b.png">d</div><img src="${PROXY}/s/ok.png">` +
        `<form action="${PROXY}/s/f"><button formaction="#">b</button></form><a href="#" ping="#">p</a>`,
    ).html;
    expect(out).toContain(`<div>d</div>`);
    expect(out).toContain(`<img src="${PROXY}/s/ok.png">`);
    expect(out).not.toMatch(/action=|formaction=|ping=/);
  });

  it("cleans the inert trees inside <template>", () => {
    const out = gate(`<template><a href="${EVIL}/t">t</a><img src="${PROXY}/s/k.png"></template>`).html;
    expect(out).not.toContain("evil.example");
    expect(out).toContain(`src="${PROXY}/s/k.png"`);
  });

  it("keeps proxy URLs, fragments, the blocked marker and image/font data URLs", () => {
    const html =
      `<img src="${PROXY}/s/a.png" srcset="${PROXY}/s/a.png 1x, ${PROXY}/s/b.png 2x"><a href="#top">t</a>` +
      `<img src="about:blank#blocked"><img src="data:image/png;base64,AA=="><a href="">e</a>`;
    const result = gate(html);
    expect(result.removed).toBe(0);
    for (const kept of [`${PROXY}/s/a.png`, `${PROXY}/s/b.png 2x`, `#top`, `about:blank#blocked`, `data:image/png;base64,AA==`]) {
      expect(result.html).toContain(kept);
    }
  });

  it("refuses data URLs that carry markup and URLs on a look-alike origin", () => {
    const out = gate(`<img src="data:image/svg+xml,<svg onload=x>"><img src="${PROXY}.evil.example/x.png">`).html;
    expect(out).not.toMatch(/data:image\/svg|evil\.example/);
  });

  it("returns a stable, doctype-preserving serialisation", () => {
    const result = gate(`<!doctype html><title>t</title><p>Xin chào</p>`);
    expect(result.html.startsWith("<!DOCTYPE html><html>")).toBe(true);
    expect(gate(result.html).html).toBe(result.html);
  });

  it("fails closed when the re-parse still finds something to drop", () => {
    const real = DOMParser.prototype.parseFromString;
    let calls = 0;
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, text, type) {
      calls++;
      return real.call(this, calls % 2 === 0 ? `<a href="${EVIL}/late">x</a>` : text, type);
    });
    expect(gatePreviewCopy("<p>x</p>", OPTIONS)).toEqual({ ok: false, reason: "residual_after_reparse" });
    // An element-level offender (here <base>) in the re-parse fails closed too.
    calls = 0;
    vi.mocked(DOMParser.prototype.parseFromString).mockImplementation(function (this: DOMParser, text, type) {
      calls++;
      return real.call(this, calls === 2 ? `<base href="${EVIL}/">` : text, type);
    });
    expect(gatePreviewCopy("<p>x</p>", OPTIONS)).toEqual({ ok: false, reason: "residual_after_reparse" });
  });

  it("fails closed when the serialisation does not survive a re-parse unchanged", () => {
    const real = DOMParser.prototype.parseFromString;
    let calls = 0;
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, text, type) {
      calls++;
      return real.call(this, calls === 2 ? "<p>different</p>" : text, type);
    });
    expect(gatePreviewCopy("<p>x</p>", OPTIONS)).toEqual({ ok: false, reason: "unstable_serialisation" });
  });
});

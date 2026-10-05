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

  it("allows data URLs only where they are embedded bytes, never behind a link or reference", () => {
    const data = "data:image/svg+xml,%3Csvg%2F%3E";
    const out = gate(
      `<img src="${data}"><svg><image href="${data}"/><a href="${data}"><text>a</text></a><use href="${data}#x"/></svg>` +
        `<a href="${data}">b</a><area href="data:font/woff2,AA">` +
        `<video poster="data:image/png,AA"></video><table background="data:image/png,AA"></table>`,
    ).html;
    expect(out.match(/data:/g)).toHaveLength(4);
    expect(out).toContain(`<img src="${data}">`);
    expect(out).toContain(`<image href="${data}">`);
  });

  it("parses in no-quirks mode like a srcdoc document and always emits the standards doctype", () => {
    // Quirks mode would keep the table inside the paragraph.
    for (const copy of [`<p><table><tr><td>x</td></tr></table>`, `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><p><table></table>`]) {
      const out = gate(copy).html;
      expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(out).toContain("<p></p><table>");
    }
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

describe("preview gate: visual-edit strip pass (ADR 0026)", () => {
  const strip = (html: string) =>
    gatePreviewCopy(html, { ...OPTIONS, stripScripts: true });

  it("drops every <script> element in any namespace", () => {
    const result = strip(`<p>x</p><script>parent.postMessage(1)</script><svg><script>alert(1)</script></svg>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toMatch(/<script/i);
    expect(result.html).not.toContain("postMessage");
  });

  it("drops every on* handler, in any case", () => {
    const result = strip(`<div onclick="a()" ONMOUSEOVER="b()" onerror="c()">x</div><img src="about:blank#blocked" onload="d()">`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(result.html).not.toContain("a()");
  });

  it("drops <script> in every namespace, any case, and inside <template> (SEC F11)", () => {
    const result = strip(
      `<p>x</p><SCRIPT>a()</SCRIPT><math><script>b()</script></math><template><script>c()</script></template>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toMatch(/<script/i);
    expect(result.html).not.toMatch(/a\(\)|b\(\)|c\(\)/);
  });

  it("drops an SVG animation onbegin handler and a nonce-bearing document script (SEC F11)", () => {
    const result = strip(
      `<svg><animate onbegin="a()" attributeName="x" dur="1s"></animate></svg><script nonce="deadbeef">b()</script>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toMatch(/onbegin|<script/i);
  });

  it("drops a document-supplied CSP meta but keeps the host's own (SEC F7)", () => {
    const host = "default-src 'none'; script-src 'nonce-a'";
    const result = gatePreviewCopy(
      `<head><meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
        `<meta http-equiv="content-security-policy" content="${host}">` +
        `<meta name="viewport" content="width=device-width"></head><body><p>x</p></body>`,
      { ...OPTIONS, stripScripts: true, csp: host },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exactly one CSP meta survives, and it is the host policy.
    expect(result.html.match(/Content-Security-Policy/gi) ?? []).toHaveLength(1);
    expect(result.html).toContain(host);
    expect(result.html).not.toContain("script-src 'none'");
    // A non-CSP meta is untouched: the rule only drops CSP metas.
    expect(result.html).toContain('<meta name="viewport" content="width=device-width">');
  });

  it("keeps a document CSP meta when stripping is off (plain preview byte-parity)", () => {
    const result = gatePreviewCopy(`<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain("script-src 'none'");
  });

  it("drops a document CSP meta in strip mode even when no host policy is named", () => {
    // The strip helper carries no `csp`, so the document meta is the only CSP
    // and must still go: it could intersect the host's policy away.
    const result = strip(
      `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` +
        `<meta http-equiv="Content-Security-Policy"><p>x</p>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toMatch(/Content-Security-Policy/i);
    expect(result.html).toContain("<p>x</p>");
  });

  it("leaves the plain preview path byte-identical (stripScripts off by default)", () => {
    const html = `<p>x</p><script>kept</script><div onclick="kept()">y</div>`;
    const off = gatePreviewCopy(html, OPTIONS);
    const offAgain = gatePreviewCopy(html, { ...OPTIONS, stripScripts: false });
    expect(off.ok && offAgain.ok && off.html === offAgain.html).toBe(true);
    if (!off.ok) return;
    // Off: the copy still carries the script/handler; the CSP is what stops it.
    expect(off.html).toContain("<script>kept</script>");
    expect(off.html).toContain('onclick="kept()"');
  });

  it("fails closed when a re-parse re-introduces a script or handler after stripping", () => {
    const real = DOMParser.prototype.parseFromString;
    let calls = 0;
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (this: DOMParser, text: string, type: DOMParserSupportedType) {
      calls++;
      // The verification re-parse (second call) shows an on* handler the fix
      // pass removed: the copy did not stay stripped, so it must be refused.
      return real.call(this, calls === 2 ? `<div onclick="x()">x</div>` : text, type);
    });
    expect(strip("<p>x</p>")).toEqual({ ok: false, reason: "residual_after_reparse" });
    calls = 0;
    vi.mocked(DOMParser.prototype.parseFromString).mockImplementation(function (this: DOMParser, text: string, type: DOMParserSupportedType) {
      calls++;
      return real.call(this, calls === 2 ? `<p>x</p><script>alert(1)</script>` : text, type);
    });
    expect(strip("<p>x</p>")).toEqual({ ok: false, reason: "residual_after_reparse" });
  });

  it("does not weaken any existing drop rule when stripping", () => {
    const result = strip(
      `<base href="${EVIL}/"><iframe src="${EVIL}/i"></iframe><object data="${EVIL}/o"></object>` +
        `<a href="javascript:alert(1)">j</a><a href="${EVIL}/a">a</a>`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toMatch(/evil\.example|javascript:|<base|<iframe|<object/i);
  });
});

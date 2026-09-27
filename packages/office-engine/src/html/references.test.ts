import { describe, expect, it } from "vitest";
import { extractHtmlAssetReferences, rewriteHtmlAssetReferences, rewriteHtmlUrls, scanHtmlSlots, slotUrls } from "./references";

const PAGE = `<!doctype html>
<html lang="vi"><head>
<link rel="stylesheet" href="css/site.css">
<link rel="icon" href='favicon.ico'>
<link rel="preload" as="font" href="fonts/a.woff2">
<link rel="canonical" href="https://example.com/">
<style>
@import "css/print.css";
@font-face { font-family: X; src: url(fonts/x.woff2) format("woff2"); }
body { background: url('img/bg one.png'); }
</style>
<script src="js/app.js"></script>
<script>var s = "<img src='not-a-ref.png'>";</script>
<title><img src="title.png"></title>
</head><body background="img/body.png">
<!-- <img src="commented.png"> -->
<img src="img/a&amp;b.png" srcset="img/a-1x.png 1x, img/a-2x.png 2x" alt="Ảnh">
<video poster="img/poster.png" src="media/v.mp4"></video>
<svg><use href="icons.svg#star"/><image xlink:href="img/svg.png"/></svg>
<div style="background-image:url(&quot;img/inline.png&quot;)"></div>
<object data="doc.svg"></object>
<iframe src="frame.html" srcdoc="<p>x</p>"></iframe>
<a href="other.html">link</a>
<base href="https://evil.example/">
<meta http-equiv="refresh" content="0;url=https://evil.example/">
<img src=unquoted.png>
</body></html>`;

describe("HTML reference scanner", () => {
  it("finds every asset-bearing slot, skipping comments, script bodies and RCDATA", () => {
    expect(extractHtmlAssetReferences(PAGE)).toEqual([
      "css/site.css",
      "favicon.ico",
      "fonts/a.woff2",
      "css/print.css",
      "fonts/x.woff2",
      "img/bg one.png",
      "js/app.js",
      "img/body.png",
      "img/a&b.png",
      "img/a-1x.png",
      "img/a-2x.png",
      "img/poster.png",
      "media/v.mp4",
      "icons.svg#star",
      "img/svg.png",
      "img/inline.png",
      "doc.svg",
      "frame.html",
      "unquoted.png",
    ]);
  });

  it("assigns roles by element and context", () => {
    const roles = scanHtmlSlots(PAGE).flatMap((s) => slotUrls(s).map((u) => u.url + "=" + u.role));
    expect(roles).toEqual(
      expect.arrayContaining([
        "css/site.css=style",
        "https://example.com/=link",
        "fonts/x.woff2=font",
        "css/print.css=style",
        "js/app.js=script",
        "media/v.mp4=media",
        "doc.svg=frame",
        "other.html=navigation",
        "https://evil.example/=base",
        "0;url=https://evil.example/=refresh",
        "<p>x</p>=srcdoc",
      ]),
    );
  });

  it("rewrites only the changed slot and keeps every other byte", () => {
    const out = rewriteHtmlAssetReferences(PAGE, new Map([["img/bg one.png", "assets/bg one.png"], ["img/a&b.png", 'assets/a&"b.png']]));
    expect(out).toContain(`url("assets/bg one.png")`);
    expect(out).toContain(`src="assets/a&amp;&quot;b.png"`);
    // Everything outside the two slots is untouched.
    const a = PAGE.replace(`url('img/bg one.png')`, "").replace(`img/a&amp;b.png`, "");
    const b = out.replace(`url("assets/bg one.png")`, "").replace(`assets/a&amp;&quot;b.png`, "");
    expect(b).toBe(a);
    expect(rewriteHtmlAssetReferences(PAGE, new Map())).toBe(PAGE);
  });

  it("encodes a replacement for its quoting context", () => {
    const html = `<img src=a.png><img src='b.png'><div style='background:url(c.png)'></div>`;
    const out = rewriteHtmlUrls(html, (u) => "x y'" + u.url);
    expect(out).toBe(`<img src=x&#32;y&#39;a.png><img src='x y&#39;b.png'><div style='background:url("x y&#39;c.png")'></div>`);
  });

  it("scans svg/math <style>/<title>/<script> bodies as live markup, like the HTML parser", () => {
    const html =
      `<svg><style><a href="https://x.example/s">s</a><image href="img/s.png"/></style>` +
      `<title><a href="https://x.example/t">t</a></title><script><image href="img/j.png"/></script></svg>` +
      `<math><style><img src="img/m.png"></style></math>`;
    const urls = scanHtmlSlots(html).flatMap((s) => slotUrls(s).map((u) => u.url + "=" + u.role));
    expect(urls).toEqual([
      "https://x.example/s=navigation",
      "img/s.png=image",
      "https://x.example/t=navigation",
      "img/j.png=image",
      "img/m.png=image",
    ]);
  });

  it("returns to raw-text scanning at integration points, breakouts and after </svg>", () => {
    const hidden = `<a href="https://hidden.example">no</a>`;
    expect(extractHtmlAssetReferences(`<svg><foreignObject><style>${hidden}</style></foreignObject></svg>`)).toEqual([]);
    expect(scanHtmlSlots(`<svg><foreignObject><style>${hidden}</style></foreignObject></svg>`).map((s) => s.kind)).toEqual(["css"]);
    expect(scanHtmlSlots(`<svg></svg><style>${hidden}</style>`).map((s) => s.kind)).toEqual(["css"]);
    expect(scanHtmlSlots(`<svg><p>x</p><style>${hidden}</style>`).map((s) => s.kind)).toEqual(["css"]);
    expect(scanHtmlSlots(`<svg/><style>${hidden}</style>`).map((s) => s.kind)).toEqual(["css"]);
    expect(scanHtmlSlots(`<svg><svg></svg><title>${hidden}</title></svg>`).map((s) => s.role)).toEqual(["navigation"]);
  });

  it("decodes numeric entities and tolerates unterminated markup", () => {
    expect(extractHtmlAssetReferences(`<img src="a&#46;png"><img src="&#x62;.png"><img src="&bogus;.png">`)).toEqual([
      "a.png",
      "b.png",
      "&bogus;.png",
    ]);
    expect(extractHtmlAssetReferences(`<img src="open.png`)).toEqual(["open.png"]);
    expect(extractHtmlAssetReferences(`<!-- never closed <img src="x.png">`)).toEqual([]);
    expect(extractHtmlAssetReferences(`<style>a{background:url(x.png)}`)).toEqual(["x.png"]);
    expect(extractHtmlAssetReferences(`<style>a{background:url(x.png)}</style ><img src=y.png>`)).toEqual(["x.png", "y.png"]);
    expect(extractHtmlAssetReferences(`a < b <? pi ?> </p> <img src=ok.png`)).toEqual(["ok.png"]);
    expect(extractHtmlAssetReferences(`<link rel="modulepreload" href="m.js"><link rel=prefetch as=image href=p.png>`)).toEqual([
      "m.js",
      "p.png",
    ]);
  });
});

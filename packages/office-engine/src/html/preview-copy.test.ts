import { describe, expect, it } from "vitest";
import type { AssetManifest } from "../assets/manifest";
import { fakeHtmlUpstream, utf8 } from "../assets/test-fakes";
import { createHtmlEngine } from "./engine";
import { BLOCKED_URL, buildHtmlPreviewCopy } from "./preview-copy";

const SHA = "b".repeat(64);
const entry = (key: string, media_type: string) => ({ key, sha256: SHA, byte_length: 1, media_type, origin: "imported" as const });
const MANIFEST: AssetManifest = {
  version: 1,
  document_path: "index.html",
  entries: [
    entry("img/a b.png", "image/png"),
    entry("img/logo.svg", "image/svg+xml"),
    entry("css/site.css", "text/css"),
    entry("js/app.js", "text/javascript"),
    entry("fonts/x.woff2", "font/woff2"),
    entry("blob.bin", "application/octet-stream"),
    entry("secret.png", "image/png"),
  ],
};
const PROXY = "https://preview-assets.example/s/scope-1/";
const granted = (key: string) => (key === "secret.png" ? null : PROXY + encodeURIComponent(key));
const CSP = "default-src 'none'";

const copy = (text: string, extra: Partial<Parameters<typeof buildHtmlPreviewCopy>[0]> = {}) =>
  buildHtmlPreviewCopy({ text, manifest: MANIFEST, assetUrl: granted, scripts: false, csp: CSP, ...extra });

describe("HTML preview copy", () => {
  it("points granted local assets at the scoped proxy, keeping an SVG fragment", () => {
    const out = copy(`<img src="img/a%20b.png"><img src="img/logo.svg#star"><link rel="stylesheet" href="css/site.css">`);
    expect(out).toContain(`src="${PROXY}img%2Fa%20b.png"`);
    expect(out).toContain(`src="${PROXY}img%2Flogo.svg#star"`);
    expect(out).toContain(`href="${PROXY}css%2Fsite.css"`);
  });

  it("blocks external, traversal, absolute, file and dangling references", () => {
    const refs = ["https://tracker.example/p.gif", "//cdn.example/x.png", "../../etc/passwd", "C:\\Windows\\win.ini", "file:///etc/hosts", "missing.png"];
    const seen: string[] = [];
    const out = copy(refs.map((r) => `<img src="${r}">`).join(""), {
      assetUrl: (key) => {
        seen.push(key);
        return granted(key);
      },
    });
    for (const r of refs) expect(out).not.toContain(r);
    expect(out.split(BLOCKED_URL)).toHaveLength(refs.length + 1);
    // Nothing refused or external ever reaches the proxy.
    expect(seen).toEqual([]);
  });

  it("applies the render policy without touching the preserved bytes", () => {
    const out = copy(`<object data="img/logo.svg"></object><img src="blob.bin"><img src="secret.png"><script src="js/app.js"></script>`);
    expect(out).not.toContain(PROXY);
    const withScripts = copy(`<script src="js/app.js"></script>`, { scripts: true });
    expect(withScripts).toContain(`src="${PROXY}js%2Fapp.js"`);
  });

  it("keeps renderable data: URIs and blocks the rest", () => {
    const out = copy(`<img src="data:image/png;base64,AA"><iframe src="data:text/html,<script>x</script>"></iframe>`);
    expect(out).toContain(`src="data:image/png;base64,AA"`);
    expect(out).toContain(`<iframe src="${BLOCKED_URL}"`);
  });

  it("neutralises navigation, <base>, meta refresh and srcdoc in the copy", () => {
    const out = copy(
      `<a href="https://evil.example/">x</a><a href="#top">y</a><base href="https://evil.example/">` +
        `<meta http-equiv="refresh" content="0;url=https://evil.example/"><iframe srcdoc="<img src=x>"></iframe>` +
        `<link rel="canonical" href="https://evil.example/c">`,
    );
    expect(out).not.toContain("evil.example");
    expect(out).toContain(`<a href="#top">`);
    expect(out).toContain(`content=""`);
    expect(out).toContain(`srcdoc=""`);
  });

  it("rewrites CSS url() and font references", () => {
    const out = copy(`<style>@font-face{src:url(fonts/x.woff2)} body{background:url(https://evil.example/bg.png)}</style>`);
    expect(out).toContain(`url("${PROXY}fonts%2Fx.woff2")`);
    expect(out).toContain(`url("${BLOCKED_URL}")`);
  });

  it("puts the policy first, after the doctype, and escapes it", () => {
    const out = copy(`<!-- c --><!DOCTYPE html><html><head><title>t</title></head></html>`, {
      csp: `default-src 'none'; img-src "x"`,
      color_scheme: "dark",
      head_injection: "<script>bridge()</script>",
    });
    expect(out.startsWith(`<!-- c --><!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src &quot;x&quot;">`)).toBe(true);
    expect(out).toContain(`<meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark"><script>bridge()</script><html>`);
    expect(copy("<p>no doctype</p>").startsWith("<meta http-equiv")).toBe(true);
  });

  it("never changes the source a save serialises (theme and rewrites are copy-only)", async () => {
    const html = createHtmlEngine({ upstream: fakeHtmlUpstream() });
    const source = `<!doctype html><img src="img/a%20b.png"><a href="https://x.example">x</a>`;
    const outcome = await html.open({ bytes: utf8(source), format: "html", document_id: "H1", asset_manifest: MANIFEST });
    if (outcome.outcome !== "opened") throw new Error("open");
    const ref = outcome.document_model_ref;
    const before = await html.serialize({ document_model_ref: ref, format: "html" });
    copy(html.snapshot(ref).text, { color_scheme: "dark" });
    const after = await html.serialize({ document_model_ref: ref, format: "html" });
    expect(after.bytes).toEqual(before.bytes);
    expect(new TextDecoder().decode(after.bytes)).toBe(source);
  });
});

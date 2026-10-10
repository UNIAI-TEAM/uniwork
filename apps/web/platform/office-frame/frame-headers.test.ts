import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPin, parseCspManifest, parseManifest, sha256Hex } from "./frame-bundle.mjs";
import { officeFrameHeaderRules, pinPath, readPin, readPins } from "./frame-headers.mjs";

const pin = buildPin(
  parseManifest({ version: "1.0.0-abc1234", gitSha: "abc1234", entry: "index.html", files: [{ path: "index.html", bytes: 1, sha256: sha256Hex("x") }] }),
  sha256Hex("m"),
  parseCspManifest({ headers: { "Content-Security-Policy": "default-src 'self'; worker-src 'self' blob:", "Permissions-Policy": "camera=()", "X-Frame-Options": "ALLOWALL", "Cache-Control": "no-store" } }),
);
const byKey = (rule: { headers: { key: string; value: string }[] }) => Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));

describe("officeFrameHeaderRules", () => {
  const [locked, security, mutable, immutable] = officeFrameHeaderRules({ docs: pin });

  it("locks every path under /office-frame down first, then gives a module's paths its pinned CSP, same-origin framing and nosniff", () => {
    expect(locked?.source).toBe("/office-frame/:path*");
    expect(byKey(locked!)["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(security?.source).toBe("/office-frame/docs/:path*");
    expect(byKey(security!)).toEqual({
      "Content-Security-Policy": "default-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'",
      "Permissions-Policy": "camera=()",
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
  });
  it("never lets the bundle's own headers override framing or caching policy", () => {
    const keys = security!.headers.map((h) => h.key.toLowerCase());
    expect(keys.filter((k) => k === "x-frame-options")).toHaveLength(1);
    expect(keys).not.toContain("cache-control");
  });
  it("revalidates a version's top-level files and makes everything below a directory immutable, without overlap", () => {
    expect(mutable).toMatchObject({ source: "/office-frame/docs/:version/:file", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] });
    expect(immutable).toMatchObject({ source: "/office-frame/docs/:version/:dir/:rest+", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] });
  });
  it("without a pin serves a locked-down, same-origin-only policy", () => {
    const [, unpinned] = officeFrameHeaderRules({});
    expect(unpinned?.source).toBe("/office-frame/docs/:path*");
    expect(byKey(unpinned!)["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(byKey(unpinned!)["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
});

describe("per-module rules", () => {
  it("gives each module its own pin's policy and its own caching rules; another module's pin never leaks", () => {
    const rules = officeFrameHeaderRules({ pdf: pin });
    const sources = rules.map((r) => r.source);
    for (const m of ["docs", "pdf", "markdown", "html", "slides", "sheets"]) {
      expect(sources).toEqual(expect.arrayContaining([`/office-frame/${m}/:path*`, `/office-frame/${m}/:version/:file`, `/office-frame/${m}/:version/:dir/:rest+`]));
    }
    const of = (source: string) => byKey(rules.find((r) => r.source === source)!);
    expect(of("/office-frame/pdf/:path*")["Permissions-Policy"]).toBe("camera=()");
    expect(of("/office-frame/docs/:path*")["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(of("/office-frame/docs/:path*")).not.toHaveProperty("Permissions-Policy");
    // The catch-all comes first, so a module rule overrides it (the last value of a header wins in Next).
    expect(sources[0]).toBe("/office-frame/:path*");
  });
  it("reads one pin per module beside docs.pin.json, null where none is checked in", () => {
    expect(pinPath("docs")).toMatch(/platform\/office-frame\/docs\.pin\.json$/);
    expect(() => pinPath("../docs")).toThrow();
    const pins = readPins();
    expect(Object.keys(pins)).toEqual(["docs", "pdf", "markdown", "html", "slides", "sheets"]);
    expect(pins.docs).toEqual(readPin());
  });
});

describe("a document with its own policy", () => {
  const PREVIEW = "default-src 'none'; connect-src 'none'; form-action 'none'; sandbox allow-scripts allow-forms; frame-ancestors 'self'";
  const htmlPin = buildPin(parseManifest({ version: "1.0.0-abc1234", gitSha: "abc1234", entry: "index.html", files: [{ path: "index.html", bytes: 1, sha256: sha256Hex("x") }, { path: "preview.html", bytes: 1, sha256: sha256Hex("p") }] }), sha256Hex("m"), pin.headers, [{ path: "/preview.html", value: PREVIEW }]);
  const rules = officeFrameHeaderRules({ html: htmlPin });
  const html = rules.filter((r) => r.source.startsWith("/office-frame/html/"));

  it("serves /office-frame/html/<v>/preview.html with its own CSP, after the module's rules so it wins", () => {
    expect(html.map((r) => r.source)).toEqual([
      "/office-frame/html/:path*", "/office-frame/html/:version/:file", "/office-frame/html/:version/:dir/:rest+", "/office-frame/html/:version/preview.html",
    ]);
    const doc = byKey(html[3]!);
    expect(doc["Content-Security-Policy"]).toBe(PREVIEW);
    expect(byKey(html[0]!)["Content-Security-Policy"]).toBe("default-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'");
  });
  it("keeps the host-owned headers on the document and takes no other header from the policy", () => {
    expect(byKey(html[3]!)).toMatchObject({ "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    expect(html[3]!.headers.map((h) => h.key.toLowerCase()).filter((k) => k === "content-security-policy")).toHaveLength(1);
  });
  it("gives no other path, and no other module, a document rule", () => {
    expect(rules.filter((r) => r.source.endsWith("preview.html"))).toHaveLength(1);
    expect(officeFrameHeaderRules({ docs: pin, html: null }).some((r) => r.source.endsWith("preview.html"))).toBe(false);
  });
});

describe("the checked-in pin", () => {
  it("parses, carries the frame-ancestors policy and is not a dirty build", () => {
    const checkedIn = readPin();
    expect(checkedIn).not.toBeNull();
    expect(checkedIn!.version).not.toMatch(/dirty/);
    expect(checkedIn!.headers["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
  });
});

describe("readPin", () => {
  it("is null when no pin is checked in and parses one when it is", () => {
    const dir = mkdtempSync(join(tmpdir(), "frame-pin-"));
    expect(readPin(join(dir, "missing.json"))).toBeNull();
    writeFileSync(join(dir, "pin.json"), JSON.stringify(pin));
    expect(readPin(join(dir, "pin.json"))).toEqual(pin);
    writeFileSync(join(dir, "bad.json"), "{");
    expect(() => readPin(join(dir, "bad.json"))).toThrow();
  });
  it("rethrows a read error that is not 'missing'", () => {
    expect(() => readPin(tmpdir())).toThrow();
  });
});

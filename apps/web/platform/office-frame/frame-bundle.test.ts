import { describe, expect, it } from "vitest";
import {
  assertMatchesPin, assertSafeBundlePath, assertSafeVersion, buildPin, enforceFrameAncestors,
  parseCspManifest, parseManifest, parsePin, sha256Hex,
} from "./frame-bundle.mjs";

const sha = sha256Hex("x");
const manifest = (over: Record<string, unknown> = {}) => ({
  version: "0.1.0-abc1234", gitSha: "abc1234def", entry: "index.html",
  files: [{ path: "index.html", bytes: 1, sha256: sha }], ...over,
});

describe("assertSafeVersion / assertSafeBundlePath", () => {
  it("accepts a version-with-sha and refuses anything a path join could escape", () => {
    expect(assertSafeVersion("0.1.0-abc1234")).toBe("0.1.0-abc1234");
    for (const bad of ["", "..", ".", "a/b", "../x", "a b", ".hidden", 7, null, "x".repeat(65)]) expect(() => assertSafeVersion(bad)).toThrow();
  });
  it("accepts relative forward-slashed paths only", () => {
    expect(assertSafeBundlePath("assets/a.js")).toBe("assets/a.js");
    for (const bad of ["", "/etc/passwd", "../a", "a/../b", "a//b", "a\\b", "./a", "a\0b", 1]) expect(() => assertSafeBundlePath(bad)).toThrow();
  });
});

describe("parseManifest", () => {
  it("reads the fork manifest and ignores informational fields", () => {
    expect(parseManifest(manifest({ builtAt: "x", totalBytes: 1, gzipBytes: 1 }))).toEqual({
      version: "0.1.0-abc1234", gitSha: "abc1234def", entry: "index.html", dirty: false, files: [{ path: "index.html", bytes: 1, sha256: sha }],
    });
  });
  it("reads the dirty flag the fork sets for an uncommitted build", () => {
    expect(parseManifest(manifest()).dirty).toBe(false);
    expect(parseManifest(manifest({ dirty: true })).dirty).toBe(true);
  });
  it.each([
    ["not an object", null],
    ["unsafe version", manifest({ version: "../x" })],
    ["bad gitSha", manifest({ gitSha: "zz" })],
    ["entry outside files", manifest({ entry: "other.html" })],
    ["no files", manifest({ files: [] })],
    ["bad digest", manifest({ files: [{ path: "index.html", bytes: 1, sha256: "nope" }] })],
    ["bad size", manifest({ files: [{ path: "index.html", bytes: -1, sha256: sha }] })],
    ["escaping path", manifest({ files: [{ path: "../index.html", bytes: 1, sha256: sha }] })],
    ["duplicate path", manifest({ files: [{ path: "index.html", bytes: 1, sha256: sha }, { path: "index.html", bytes: 1, sha256: sha }] })],
  ])("refuses %s", (_name, raw) => {
    expect(() => parseManifest(raw)).toThrow();
  });
});

describe("frame-ancestors", () => {
  it("adds 'self' when absent, keeps it when exactly 'self', refuses anything wider", () => {
    expect(enforceFrameAncestors("default-src 'self';")).toBe("default-src 'self'; frame-ancestors 'self'");
    expect(enforceFrameAncestors("default-src 'self'; frame-ancestors 'self'")).toBe("default-src 'self'; frame-ancestors 'self'");
    for (const wide of ["frame-ancestors *", "frame-ancestors 'self' https://evil.test", "frame-ancestors 'none'"]) {
      expect(() => enforceFrameAncestors(`default-src 'self'; ${wide}`)).toThrow(/frame-ancestors/);
    }
    expect(() => enforceFrameAncestors("  ")).toThrow();
  });
});

describe("parseCspManifest", () => {
  const want = { "Content-Security-Policy": "default-src 'self'; frame-ancestors 'self'" };
  it("accepts a header-name keyed object, directives, a policy string and headers as map or list", () => {
    expect(parseCspManifest({ "Content-Security-Policy": "default-src 'self'" })).toEqual(want);
    expect(parseCspManifest({ directives: { "default-src": ["'self'"] } })).toEqual(want);
    expect(parseCspManifest({ policy: "default-src 'self'" })).toEqual(want);
    // The fork's build emits header + value (and directives for reading); the value wins.
    expect(parseCspManifest({ header: "Content-Security-Policy", value: "default-src 'self'", directives: { "default-src": ["'none'"] } })).toEqual(want);
    expect(parseCspManifest({ headers: { "content-security-policy": "default-src 'self'" } })).toEqual(want);
    expect(parseCspManifest({ headers: [{ name: "Content-Security-Policy", value: "default-src 'self'" }] })).toEqual(want);
    expect(parseCspManifest({ directives: { "default-src": "'self'", "worker-src": ["'self'", "blob:"] } })["Content-Security-Policy"])
      .toBe("default-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'");
  });
  it("keeps other response headers the bundle asks for", () => {
    expect(parseCspManifest({ headers: { "Content-Security-Policy": "default-src 'self'", "Permissions-Policy": "camera=()" } })).toEqual({ ...want, "Permissions-Policy": "camera=()" });
  });
  it("refuses a file with no policy, a wide frame-ancestors, or a non-object", () => {
    expect(() => parseCspManifest({})).toThrow(/no Content-Security-Policy/);
    expect(() => parseCspManifest({ policy: "frame-ancestors *" })).toThrow();
    expect(() => parseCspManifest("x")).toThrow();
  });
});

describe("pin", () => {
  const m = parseManifest(manifest());
  const headers = parseCspManifest({ policy: "default-src 'self'" });
  const pin = buildPin(m, sha, headers);
  it("round-trips through parsePin", () => {
    expect(parsePin(JSON.parse(JSON.stringify(pin)))).toEqual(pin);
  });
  it.each([
    ["schema", { ...pin, schema: 2 }], ["version", { ...pin, version: "a/b" }], ["gitSha", { ...pin, gitSha: "?" }],
    ["digest", { ...pin, manifestSha256: "abc" }], ["headers", { ...pin, headers: {} }], ["not an object", 3],
  ])("refuses a pin with a bad %s", (_name, raw) => {
    expect(() => parsePin(raw)).toThrow();
  });
  it("names every way a bundle can differ from the pin", () => {
    expect(() => assertMatchesPin(pin, m, sha)).not.toThrow();
    expect(() => assertMatchesPin(pin, { ...m, version: "9.9.9" }, sha)).toThrow(/version 9\.9\.9/);
    expect(() => assertMatchesPin(pin, { ...m, gitSha: "ffff000" }, sha)).toThrow(/gitSha/);
    expect(() => assertMatchesPin(pin, { ...m, entry: "x.html" }, sha)).toThrow(/entry/);
    expect(() => assertMatchesPin(pin, m, sha256Hex("other"))).toThrow(/digest differs/);
  });
});

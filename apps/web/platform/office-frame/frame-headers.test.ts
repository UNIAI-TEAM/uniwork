import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPin, parseCspManifest, parseManifest, sha256Hex } from "./frame-bundle.mjs";
import { officeFrameHeaderRules, readPin } from "./frame-headers.mjs";

const pin = buildPin(
  parseManifest({ version: "1.0.0-abc1234", gitSha: "abc1234", entry: "index.html", files: [{ path: "index.html", bytes: 1, sha256: sha256Hex("x") }] }),
  sha256Hex("m"),
  parseCspManifest({ headers: { "Content-Security-Policy": "default-src 'self'; worker-src 'self' blob:", "Permissions-Policy": "camera=()", "X-Frame-Options": "ALLOWALL", "Cache-Control": "no-store" } }),
);
const byKey = (rule: { headers: { key: string; value: string }[] }) => Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));

describe("officeFrameHeaderRules", () => {
  const [security, mutable, immutable] = officeFrameHeaderRules(pin);

  it("puts the pinned CSP, same-origin framing and nosniff on everything under /office-frame", () => {
    expect(security?.source).toBe("/office-frame/:path*");
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
    const [locked] = officeFrameHeaderRules(null);
    expect(byKey(locked!)["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'self'");
    expect(byKey(locked!)["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
});

describe("readPin", () => {
  it("is null when no pin is checked in and parses one when it is", () => {
    const dir = mkdtempSync(join(tmpdir(), "frame-pin-"));
    expect(readPin(pathToFileURL(join(dir, "missing.json")))).toBeNull();
    writeFileSync(join(dir, "pin.json"), JSON.stringify(pin));
    expect(readPin(pathToFileURL(join(dir, "pin.json")))).toEqual(pin);
    writeFileSync(join(dir, "bad.json"), "{");
    expect(() => readPin(pathToFileURL(join(dir, "bad.json")))).toThrow();
  });
  it("rethrows a read error that is not 'missing'", () => {
    expect(() => readPin(pathToFileURL(tmpdir()))).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { assetManifestRows, hasFailedAsset, normaliseAssetPath } from "./asset-manifest";

describe("office asset manifest view boundary", () => {
  it("normalises relative POSIX paths and rejects unsafe references", () => {
    expect(normaliseAssetPath("./assets/logo.png")).toBe("assets/logo.png");
    expect(normaliseAssetPath("assets//icons/./logo.svg")).toBe("assets/icons/logo.svg");
    for (const value of ["../secret", "assets/../secret", "/etc/passwd", "C:/secret", "https://example.test/a", "//host/a", "assets\\logo.png"]) {
      expect(normaliseAssetPath(value)).toBeNull();
    }
  });

  it("maps a safe path to an opaque asset id and fails closed for invalid rows", () => {
    const manifest = { entries: [
      { key: "assets/logo.png", asset_id: "asset-logo" },
      { key: "../escape", asset_id: "asset-escape" },
      { key: "assets/missing.png", status: "missing" as const, asset_id: "asset-missing" },
    ] };
    expect(assetManifestRows(manifest)).toEqual([
      { path: "assets/logo.png", assetId: "asset-logo", status: "ready", reason: null },
      { path: "../escape", assetId: null, status: "failed", reason: "unsafe asset path" },
      { path: "assets/missing.png", assetId: "asset-missing", status: "missing", reason: null },
    ]);
    expect(hasFailedAsset(manifest, undefined)).toBe(true);
    expect(hasFailedAsset({ entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] }, undefined)).toBe(false);
  });

  it("fails closed when a host failure key is unsafe", () => {
    expect(hasFailedAsset({ entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] }, { "https://cdn.example/logo.png": "failed" })).toBe(true);
    expect(hasFailedAsset({ entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] }, { "../escape": "missing" })).toBe(true);
    expect(hasFailedAsset({ entries: [{ key: "assets/logo.png", asset_id: "asset-logo" }] }, { "": false })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  imageDisplayUrl,
  imageResolutionStatus,
  imageSaveBlocked,
  resolveImageSource,
  type ImageAssetPort,
} from "./image-resolve";

const MANIFEST = {
  entries: [
    { path: "assets/logo.png", asset_id: "asset-logo", status: "ready" as const },
    { path: "assets/gone.png", asset_id: "asset-gone", status: "missing" as const },
    { path: "assets/denied.png", asset_id: "asset-denied", status: "unauthorised" as const },
  ],
};

const PORT: ImageAssetPort = { displayUrl: (id) => `blob:${id}` };

describe("markdown image resolution (pure rule)", () => {
  it("resolves a relative path through the manifest to the opaque asset id", () => {
    expect(resolveImageSource("assets/logo.png", MANIFEST)).toEqual({
      status: "manifest",
      path: "assets/logo.png",
      assetId: "asset-logo",
    });
    // The display URL comes from the host port, keyed by the opaque id - the
    // rule itself never builds a URL, a bucket name, an object key or a path.
    expect(imageDisplayUrl(resolveImageSource("./assets/logo.png", MANIFEST), PORT)).toBe("blob:asset-logo");
  });

  it("is a typed unavailable state for a path that is not in the manifest, never a raw fallback", () => {
    const unknown = resolveImageSource("assets/unknown.png", MANIFEST);
    expect(unknown).toEqual({ status: "unavailable", path: "assets/unknown.png", reason: "not_in_manifest" });
    expect(imageDisplayUrl(unknown, PORT)).toBeNull();
    expect(imageResolutionStatus(unknown)).toBe("unavailable:not_in_manifest");
  });

  it("reports the manifest status of a non-ready entry instead of a raw path", () => {
    expect(resolveImageSource("assets/gone.png", MANIFEST)).toEqual({
      status: "unavailable",
      path: "assets/gone.png",
      reason: "missing",
    });
    expect(resolveImageSource("assets/denied.png", MANIFEST)).toMatchObject({ reason: "unauthorised" });
  });

  it("refuses traversal, absolute, drive and scheme paths before any resolver", () => {
    for (const unsafe of ["../secret.png", "/etc/passwd", "C:/secret.png", "assets\\\\logo.png", "ftp://x/y.png"]) {
      const result = resolveImageSource(unsafe, MANIFEST);
      expect(result).toEqual({ status: "unavailable", path: unsafe, reason: "unsafe_path" });
      expect(imageDisplayUrl(result, PORT)).toBeNull();
    }
  });

  it("treats a data: URI or an http(s) URL as external bytes, not a manifest key", () => {
    expect(resolveImageSource("data:image/png;base64,AAAA", MANIFEST)).toEqual({ status: "external", url: "data:image/png;base64,AAAA" });
    expect(resolveImageSource("https://cdn.example/a.png", MANIFEST)).toEqual({ status: "external", url: "https://cdn.example/a.png" });
    expect(imageDisplayUrl(resolveImageSource("https://cdn.example/a.png", MANIFEST), PORT)).toBe("https://cdn.example/a.png");
  });

  it("returns null for a manifest hit when no host port can turn the id into a URL", () => {
    const resolved = resolveImageSource("assets/logo.png", MANIFEST);
    expect(imageDisplayUrl(resolved, undefined)).toBeNull();
    expect(imageDisplayUrl(resolved, { displayUrl: () => null })).toBeNull();
  });

  it("fails the save when the manifest carries any non-ready asset", () => {
    expect(imageSaveBlocked(MANIFEST, undefined)).toBe(true);
    expect(imageSaveBlocked({ entries: [{ path: "assets/logo.png", asset_id: "asset-logo" }] }, undefined)).toBe(false);
    expect(imageSaveBlocked({ entries: [{ path: "assets/logo.png", asset_id: "asset-logo" }] }, { "logo.png": "failed" })).toBe(true);
  });
});

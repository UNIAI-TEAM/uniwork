import { describe, expect, it } from "vitest";
import {
  emptyAssetManifest,
  parseAssetManifest,
  resolveAssetReference,
  serializeAssetManifest,
  uniqueAssetKey,
  type AssetManifest,
} from "./manifest";
import { mayRenderAsset, mayRenderInline, mediaTypeFor } from "./media";
import { PNG_BYTES } from "./test-fakes";

const SHA = "a".repeat(64);
const entry = (key: string, origin: "owned" | "imported" = "owned") => ({
  key,
  sha256: SHA,
  byte_length: 1,
  media_type: "image/png",
  origin,
});

describe("asset manifest", () => {
  it("round-trips through canonical, key-sorted JSON", () => {
    const manifest: AssetManifest = {
      version: 1,
      document_path: "document.md",
      entries: [entry("assets/b.png"), entry("assets/a.png", "imported")],
    };
    const text = serializeAssetManifest(manifest);
    expect(text.indexOf("assets/a.png")).toBeLessThan(text.indexOf("assets/b.png"));
    expect(parseAssetManifest(JSON.parse(text)).entries.map((e) => e.key)).toEqual(["assets/a.png", "assets/b.png"]);
  });

  it.each([
    ["traversal key", { entries: [entry("../x.png")] }, "canonical_key"],
    ["absolute key", { entries: [entry("/etc/passwd")] }, "canonical_key"],
    ["drive key", { entries: [entry("C:/x.png")] }, "canonical_key"],
    ["non-canonical key", { entries: [entry("./assets/x.png")] }, "canonical_key"],
    ["duplicate key", { entries: [entry("a.png"), entry("a.png")] }, "duplicate"],
    ["key naming the document", { entries: [entry("document.md")] }, "is_document"],
    ["bad digest", { entries: [{ ...entry("a.png"), sha256: "xyz" }] }, "sha256_hex"],
    ["bad length", { entries: [{ ...entry("a.png"), byte_length: -1 }] }, "non_negative_integer"],
    ["bad media type", { entries: [{ ...entry("a.png"), media_type: "" }] }, "non_empty"],
    ["bad origin", { entries: [{ ...entry("a.png"), origin: "stolen" }] }, "asset_origin"],
    ["entry not object", { entries: [7] }, "not_object"],
    ["entries not array", { entries: {} }, "not_array"],
    ["absolute document path", { document_path: "/doc.md", entries: [] }, "canonical_path"],
    ["wrong version", { version: 2, entries: [] }, "unsupported_version"],
  ])("refuses a manifest with a %s", (_name, patch, rule) => {
    expect(() => parseAssetManifest({ version: 1, document_path: "document.md", ...patch })).toThrow(
      expect.objectContaining({ name: "EngineContractViolation", rule }),
    );
    expect(() => parseAssetManifest(null)).toThrow(expect.objectContaining({ rule: "not_object" }));
  });

  it("refuses a non-canonical document path for a new manifest", () => {
    expect(() => emptyAssetManifest("../doc.md")).toThrow(expect.objectContaining({ rule: "canonical_path" }));
  });

  it("resolves references through the same manifest", () => {
    const manifest: AssetManifest = { version: 1, document_path: "notes/a.md", entries: [entry("notes/assets/x.png")] };
    expect(resolveAssetReference(manifest, "assets/x.png")).toMatchObject({ status: "resolved" });
    expect(resolveAssetReference(manifest, "assets/y.png")).toMatchObject({ status: "dangling" });
    expect(resolveAssetReference(manifest, "../../x.png")).toMatchObject({ status: "refused", reason: "traversal" });
    expect(resolveAssetReference(manifest, "https://x/y.png")).toMatchObject({ status: "not_asset" });
  });

  it("allocates unique keys under the document's assets directory", () => {
    const manifest: AssetManifest = { version: 1, document_path: "notes/a.md", entries: [entry("notes/assets/x.png")] };
    expect(uniqueAssetKey(manifest, "x.png")).toBe("notes/assets/x-1.png");
    expect(uniqueAssetKey(manifest, "x.png", new Set(["notes/assets/x-1.png"]))).toBe("notes/assets/x-2.png");
    expect(uniqueAssetKey(manifest, "README")).toBe("notes/assets/README");
  });
});

describe("media typing and the render policy", () => {
  it("prefers a binary signature, never promotes bytes to script/style", () => {
    expect(mediaTypeFor("assets/photo.jpg", PNG_BYTES)).toBe("image/png");
    expect(mediaTypeFor("a.svg", new Uint8Array([60]))).toBe("image/svg+xml");
    expect(mediaTypeFor("a.bin", new Uint8Array([1]))).toBe("application/octet-stream");
    expect(mediaTypeFor("noext", new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(mediaTypeFor("x.gif", new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    expect(mediaTypeFor("x", new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });

  it("renders SVG only as an image, never unknown bytes, scripts only on request", () => {
    const off = { scripts: false };
    expect(mayRenderAsset("image/svg+xml", "image", off)).toBe(true);
    expect(mayRenderAsset("image/svg+xml", "frame", off)).toBe(false);
    expect(mayRenderAsset("application/octet-stream", "image", off)).toBe(false);
    expect(mayRenderAsset("text/javascript", "script", off)).toBe(false);
    expect(mayRenderAsset("text/javascript", "script", { scripts: true })).toBe(true);
    expect(mayRenderAsset("text/css", "style", off)).toBe(true);
    expect(mayRenderAsset("font/woff2", "font", off)).toBe(true);
    expect(mayRenderAsset("video/mp4", "media", off)).toBe(true);
    expect(mayRenderAsset("text/html", "link", off)).toBe(false);
    expect(mayRenderInline("image/png", "image")).toBe(true);
    expect(mayRenderInline("text/html", "image")).toBe(false);
    expect(mayRenderInline("font/woff", "font")).toBe(true);
    expect(mayRenderInline("text/javascript", "script")).toBe(false);
  });
});

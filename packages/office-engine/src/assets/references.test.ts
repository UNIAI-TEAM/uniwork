import { describe, expect, it } from "vitest";
import { normaliseAssetReference, relativeReference, sanitizeAssetName } from "./references";

describe("normaliseAssetReference", () => {
  it.each([
    ["assets/a.png", "document.md", "assets/a.png", ""],
    ["./assets/a.png", "document.md", "assets/a.png", ""],
    ["assets/ảnh chụp màn hình.png", "document.md", "assets/ảnh chụp màn hình.png", ""],
    ["assets/my%20image.png", "document.md", "assets/my image.png", ""],
    ["assets\\win.png", "document.md", "assets/win.png", ""],
    ["../shared/logo.svg", "notes/a.md", "shared/logo.svg", ""],
    ["icons.svg#star", "index.html", "icons.svg", "#star"],
    ["a.css?v=2", "index.html", "a.css", "?v=2"],
  ])("maps %s from %s to key %s", (raw, doc, key, suffix) => {
    expect(normaliseAssetReference(raw, doc)).toEqual({ kind: "local", raw, key, suffix });
  });

  it.each([
    ["../escape.png", "document.md", "traversal"],
    ["assets/../../escape.png", "document.md", "traversal"],
    ["..%2F..%2Fescape.png", "notes/a.md", "traversal"],
    [".", "document.md", "traversal"],
    ["/etc/passwd", "document.md", "absolute_path"],
    ["\\\\server\\share\\x.png", "document.md", "absolute_path"],
    ["C:\\Users\\me\\x.png", "document.md", "absolute_path"],
    ["c:/Users/me/x.png", "document.md", "absolute_path"],
    ["%2Fetc%2Fpasswd", "document.md", "absolute_path"],
    ["C:%5Cwin.ini", "document.md", "absolute_path"],
    ["%43%3A%5Cwin.ini", "document.md", "absolute_path"],
    ["\\", "document.md", "absolute_path"],
    ["file:///etc/passwd", "document.md", "file_url"],
    ["javascript:alert(1)", "document.md", "scheme"],
    ["blob:https://app/x", "document.md", "scheme"],
    ["a\u0000.png", "document.md", "control_character"],
    ["a%00.png", "document.md", "control_character"],
    ["bad%zz.png", "document.md", "encoding"],
  ])("refuses %s (%s) as %s", (raw, doc, reason) => {
    expect(normaliseAssetReference(raw, doc)).toMatchObject({ kind: "refused", reason });
  });

  it("classifies non-asset references", () => {
    expect(normaliseAssetReference("https://cdn.example/x.js", "i.html").kind).toBe("external");
    expect(normaliseAssetReference("//cdn.example/x.js", "i.html").kind).toBe("external");
    expect(normaliseAssetReference("data:image/png;base64,AA", "i.html")).toMatchObject({
      kind: "inline",
      media_type: "image/png",
    });
    expect(normaliseAssetReference("#top", "i.html").kind).toBe("fragment");
    expect(normaliseAssetReference("   ", "i.html").kind).toBe("empty");
  });
});

describe("relativeReference", () => {
  it.each([
    ["assets/a b.png", "document.md", "assets/a b.png"],
    ["notes/assets/x.png", "notes/a.md", "assets/x.png"],
    ["shared/logo.svg", "notes/deep/a.md", "../../shared/logo.svg"],
    ["assets/100%.png", "document.md", "assets/100%25.png"],
    ["assets/q?#.png", "document.md", "assets/q%3F%23.png"],
  ])("authors %s from %s as %s and resolves back", (key, doc, expected) => {
    const authored = relativeReference(key, doc);
    expect(authored).toBe(expected);
    expect(normaliseAssetReference(authored, doc)).toMatchObject({ kind: "local", key, suffix: "" });
  });
});

describe("sanitizeAssetName", () => {
  it("keeps Unicode and spaces, strips separators and reserved characters", () => {
    expect(sanitizeAssetName("C:\\tmp\\ảnh chụp.PNG")).toBe("ảnh chụp.png");
    expect(sanitizeAssetName("../../..")).toBe("asset");
    expect(sanitizeAssetName("a:b*c?.png")).toBe("a_b_c_.png");
    expect(sanitizeAssetName(".hidden")).toBe("hidden");
  });
});

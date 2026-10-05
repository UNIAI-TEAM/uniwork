import { describe, expect, it } from "vitest";
import { savedSignatureThumbnail } from "./thumbnail";
import type { SavedSignature } from "./types";

const row = (over: Partial<SavedSignature> = {}): SavedSignature => ({
  id: "s1",
  label: "Chữ ký",
  content_type: "image/png",
  image: "iVBORw0KGgo=",
  byte_size: 8,
  created_at: "2026-10-03T08:00:00Z",
  ...over,
});

describe("savedSignatureThumbnail", () => {
  it("builds the data URL from the stored base64 and declared type", () => {
    expect(savedSignatureThumbnail(row())).toEqual({ dataUrl: "data:image/png;base64,iVBORw0KGgo=", missing: false });
  });

  it("degrades to a glyph when the row carries no bytes or type", () => {
    expect(savedSignatureThumbnail(row({ image: "" }))).toEqual({ dataUrl: "", missing: true });
    expect(savedSignatureThumbnail(row({ content_type: "" }))).toEqual({ dataUrl: "", missing: true });
  });
});

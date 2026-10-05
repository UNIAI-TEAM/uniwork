import { describe, expect, it } from "vitest";
import { toStampSignatureSource } from "./signature-source";

describe("toStampSignatureSource", () => {
  it("maps the wire row onto the palette's placement source", () => {
    expect(
      toStampSignatureSource({
        id: "s1",
        label: "Chữ ký của tôi",
        content_type: "image/png",
        image: "iVBORw0KGgo=",
        byte_size: 8,
        created_at: "2026-10-03T08:00:00Z",
      }),
    ).toEqual({ id: "s1", label: "Chữ ký của tôi", contentType: "image/png", image: "iVBORw0KGgo=" });
  });
});

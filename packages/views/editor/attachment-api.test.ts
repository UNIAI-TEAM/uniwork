import { ApiError } from "@uniwork/core/api/http";
import { describe, expect, it } from "vitest";
import { mapPreviewError, PreviewTooLargeError, PreviewUnsupportedError } from "./attachment-api";

function mapped(err: unknown): unknown {
  try {
    mapPreviewError(err);
  } catch (e) {
    return e;
  }
  throw new Error("mapPreviewError returned");
}

describe("mapPreviewError", () => {
  it.each([
    ["legacy code", new ApiError("too big", "too_large", 413)],
    ["FileService code", new ApiError("too big", "file_too_large", 413)],
    ["FileService code on an unexpected status", new ApiError("too big", "file_too_large", 400)],
    ["malformed body (http.ts falls back to internal)", new ApiError("Payload Too Large", "internal", 413)],
  ])("maps %s to PreviewTooLargeError", (_name, err) => {
    expect(mapped(err)).toBeInstanceOf(PreviewTooLargeError);
  });

  it.each([
    ["legacy code", new ApiError("bad type", "unsupported_media_type", 415)],
    ["FileService code", new ApiError("bad type", "file_type_rejected", 415)],
    ["malformed body (http.ts falls back to internal)", new ApiError("Unsupported Media Type", "internal", 415)],
  ])("maps %s to PreviewUnsupportedError", (_name, err) => {
    expect(mapped(err)).toBeInstanceOf(PreviewUnsupportedError);
  });

  it("rethrows everything else unchanged", () => {
    const notFound = new ApiError("gone", "file_not_found", 404);
    expect(mapped(notFound)).toBe(notFound);
    const conflict = new ApiError("replay", "idempotency_conflict", 409);
    expect(mapped(conflict)).toBe(conflict);
    const plain = new Error("network");
    expect(mapped(plain)).toBe(plain);
  });
});

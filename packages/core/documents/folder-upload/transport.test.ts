import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/http";
import { asFolderUploadRefusal, FolderUploadRefusedError } from "./transport";

describe("asFolderUploadRefusal", () => {
  it("turns a 422 plan refusal into a typed refusal with its fields", () => {
    const err = new ApiError("too many", "folder_upload_too_many_files", 422, "c1", { max: 500, count: 612 });
    const refusal = asFolderUploadRefusal(err);
    expect(refusal).toBeInstanceOf(FolderUploadRefusedError);
    expect(refusal).toMatchObject({ code: "folder_upload_too_many_files", status: 422, fields: { max: 500, count: 612 } });
    expect(refusal?.known).toBe(true);
  });

  it("carries Retry-After of a 429 busy answer as fields.retry_after", () => {
    const err = new ApiError("busy", "folder_uploads_busy", 429, undefined, {}, undefined, 30);
    expect(asFolderUploadRefusal(err)?.fields).toEqual({ retry_after: 30 });
  });

  it("keeps an unknown code so the UI can fall back to a generic sentence", () => {
    const refusal = asFolderUploadRefusal(new ApiError("x", "brand_new_code", 422));
    expect(refusal?.code).toBe("brand_new_code");
    expect(refusal?.known).toBe(false);
  });

  it("names a codeless 4xx by its status", () => {
    expect(asFolderUploadRefusal(new ApiError("", "internal", 404))?.code).toBe("http_404");
  });

  it("is null for what is not a refusal: 5xx, network, abort", () => {
    expect(asFolderUploadRefusal(new ApiError("", "internal", 503))).toBeNull();
    expect(asFolderUploadRefusal(new TypeError("Failed to fetch"))).toBeNull();
    expect(asFolderUploadRefusal(new DOMException("Aborted", "AbortError"))).toBeNull();
  });
});

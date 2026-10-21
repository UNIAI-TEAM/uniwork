import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { FolderUploadRefusedError } from "@uniwork/core/documents/folder-upload";
import { initI18n } from "@uniwork/core/i18n";
import { failureReasonMessage, refusalMessage, runErrorMessage } from "./folder-upload-copy";

const i18n = initI18n();
const { t } = i18n;
const en = i18n.getFixedT("en");

const refused = (code: string, fields: Record<string, unknown> = {}, status = 422) =>
  new FolderUploadRefusedError(code, status, fields, code);

describe("runErrorMessage", () => {
  it("names the numbers of the plan refusals", () => {
    expect(runErrorMessage(t, refused("folder_upload_too_many_files", { max: 500, count: 612 }), "vi")).toBe(
      "612 tệp — tối đa 500.",
    );
    expect(runErrorMessage(t, refused("folder_upload_too_large", { max_bytes: 2 * 1024 ** 3, total_bytes: 2.4 * 1024 ** 3 }), "vi")).toBe(
      "Tổng dung lượng 2,4 GB — tối đa 2 GB.",
    );
    expect(runErrorMessage(t, refused("document_too_deep", { max_depth: 20 }), "vi")).toBe(
      "Thư mục lồng quá sâu — tối đa 20 cấp.",
    );
    expect(runErrorMessage(t, refused("folder_upload_too_many_folders", { max: 500, count: 530 }), "vi")).toBe(
      "530 thư mục con — tối đa 500.",
    );
  });

  it("has a sentence for every other plan code and the batch states", () => {
    for (const code of [
      "folder_upload_file_too_large",
      "folder_upload_unsupported_type",
      "document_parent_kind",
      "invalid_request",
      "folder_uploads_busy",
      "idempotency_payload_mismatch",
      "folder_upload_expired",
      "folder_upload_canceled",
      "http_403",
      "http_404",
    ]) {
      const message = runErrorMessage(t, refused(code, {}, code === "folder_uploads_busy" ? 429 : 422), "vi");
      expect(message, code).not.toBe(t("documents.folder_upload.error.unknown"));
      expect(message, code).not.toContain("documents.folder_upload");
    }
  });

  it("reads an ApiError the same way and shows 429 and 410 by status", () => {
    expect(runErrorMessage(t, new ApiError("busy", "folder_uploads_busy", 429), "vi")).toBe(
      t("documents.folder_upload.error.folder_uploads_busy"),
    );
    expect(runErrorMessage(t, new ApiError("gone", "folder_upload_expired", 410), "vi")).toBe(
      t("documents.folder_upload.error.folder_upload_expired"),
    );
    expect(runErrorMessage(t, new ApiError("conflict", "folder_upload_canceled", 409), "vi")).toBe(
      t("documents.folder_upload.error.folder_upload_canceled"),
    );
  });

  it("falls back to the generic sentence for an unknown code, a 5xx and a plain Error", () => {
    const generic = t("documents.folder_upload.error.unknown");
    expect(runErrorMessage(t, refused("brand_new_code"), "vi")).toBe(generic);
    expect(runErrorMessage(t, new ApiError("boom", "internal", 500), "vi")).toBe(generic);
    expect(runErrorMessage(t, new Error("network"), "vi")).toBe(generic);
  });

  it("speaks English with the same numbers", () => {
    expect(en("documents.folder_upload.error.folder_upload_too_many_files", { max: "500", actual: "612" })).toBe(
      "612 files — 500 at most.",
    );
    expect(en("documents.folder_upload.error.folder_upload_too_large", { max: "2 GB", total: "2.4 GB" })).toBe(
      "Total size 2.4 GB — 2 GB at most.",
    );
  });
});

describe("failureReasonMessage", () => {
  it("has one sentence per v0.2 file code", () => {
    const generic = failureReasonMessage(t, "no_such_code");
    for (const code of [
      "upload_missing",
      "size_mismatch",
      "unsupported_media",
      "storage_quota_exceeded",
      "not_found",
      "parts_invalid",
      "missing_etag",
    ]) {
      expect(failureReasonMessage(t, code), code).not.toBe(generic);
    }
    expect(failureReasonMessage(t, undefined)).toBe(generic);
  });
});

describe("refusalMessage", () => {
  it("names the folder count of the too_many_folders refusal", () => {
    expect(refusalMessage(t, { code: "too_many_folders", limit: 500, actual: 530 } as never, "vi")).toBe(
      "530 thư mục — tối đa 500",
    );
  });
});

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
      "folder_upload_file_settled",
      "folder_upload_target_signed",
      "http_403",
      "http_404",
    ]) {
      const message = runErrorMessage(t, refused(code, {}, code === "folder_uploads_busy" ? 429 : 422), "vi");
      expect(message, code).not.toBe(t("documents.folder_upload.error.unknown"));
      expect(message, code).not.toContain("documents.folder_upload");
    }
  });

  it("reads an ApiError the same way and shows 429 by status", () => {
    expect(runErrorMessage(t, new ApiError("busy", "folder_uploads_busy", 429), "vi")).toBe(
      t("documents.folder_upload.error.folder_uploads_busy"),
    );
  });

  it("never prints a bare file_key (AMENDMENT 6): only file_key reads as the unnamed sentence", () => {
    for (const code of ["invalid_request", "folder_upload_file_too_large", "folder_upload_unsupported_type"]) {
      const message = runErrorMessage(t, refused(code, { file_key: "f-0007", max_bytes: 1024 }), "vi");
      expect(message, code).toBe(runErrorMessage(t, refused(code, { max_bytes: 1024 }), "vi"));
      expect(message, code).not.toContain("f-0007");
    }
  });

  it("shows the path of a file the server named by file_key (core FX4: fields carry file_key, path and filename)", () => {
    const fields = { file_key: "f-0007", path: "Báo cáo/2026/a:b.pdf", filename: "a:b.pdf" };
    for (const code of ["invalid_request", "folder_upload_unsupported_type", "folder_upload_file_too_large"]) {
      const message = runErrorMessage(t, refused(code, { ...fields, max_bytes: 1024 }), "vi");
      expect(message, code).toContain("Báo cáo/2026/a:b.pdf");
      expect(message, code).not.toContain("f-0007");
    }
    expect(runErrorMessage(en, refused("invalid_request", fields), "en")).toContain("Báo cáo/2026/a:b.pdf");
  });

  it("names the file of a refusal that carries fields.path or fields.filename", () => {
    const invalid = runErrorMessage(t, refused("invalid_request", { path: "Báo cáo/a:b.pdf" }), "vi");
    expect(invalid).toContain("Báo cáo/a:b.pdf");
    expect(runErrorMessage(t, refused("invalid_request", { file_key: "k1" }), "vi")).toBe(
      t("documents.folder_upload.error.invalid_request"),
    );
    const tooLarge = runErrorMessage(
      t,
      refused("folder_upload_file_too_large", { path: "Dự án/phim.pdf", filename: "phim.pdf", max_bytes: 200 * 1024 ** 2 }),
      "vi",
    );
    expect(tooLarge).toContain("Dự án/phim.pdf");
    expect(tooLarge).toContain("200 MB");
    const unsupported = runErrorMessage(t, refused("folder_upload_unsupported_type", { filename: "x.exe" }), "vi");
    expect(unsupported).toContain("x.exe");
    expect(runErrorMessage(t, refused("folder_upload_unsupported_type"), "vi")).toBe(
      t("documents.folder_upload.error.folder_upload_unsupported_type"),
    );
    expect(en("documents.folder_upload.error.invalid_request_named", { file: "a/b.pdf" })).toContain("a/b.pdf");
  });

  it("no longer carries the keys that nothing reads", () => {
    for (const key of [
      "documents.folder_upload.dialog.failed",
      "documents.folder_upload.toast.failed",
      "documents.folder_upload.error.folder_upload_expired",
      "documents.folder_upload.error.folder_upload_canceled",
    ]) {
      expect(i18n.exists(key), key).toBe(false);
    }
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
  const SERVER = [
    "upload_missing",
    "size_mismatch",
    "unsupported_media",
    "storage_quota_exceeded",
    "not_found",
    "parts_invalid",
  ];
  const CLIENT = [
    "network",
    "target_expired",
    "http_5xx",
    "missing_etag",
    "missing_part_url",
    "untrusted_target",
    "aborted",
  ];

  it("has one sentence per server code and per client code", () => {
    const generic = failureReasonMessage(t, "no_such_code");
    for (const code of [...SERVER, ...CLIENT]) {
      expect(failureReasonMessage(t, code), code).not.toBe(generic);
      expect(en(`documents.folder_upload.report.reason.${code}`), code).not.toBe(
        en("documents.folder_upload.report.reason.unknown"),
      );
    }
    expect(failureReasonMessage(t, undefined)).toBe(generic);
  });

  it("reads any http_5xx status as the server being unavailable", () => {
    expect(failureReasonMessage(t, "http_503")).toBe(failureReasonMessage(t, "http_5xx"));
    expect(failureReasonMessage(t, "http_502")).not.toBe(failureReasonMessage(t, "no_such_code"));
  });

  it("tells the person to fix the file and upload the folder again for the final server codes", () => {
    for (const code of ["unsupported_media", "storage_quota_exceeded"]) {
      expect(failureReasonMessage(t, code), code).toContain("tải lại thư mục");
      expect(en(`documents.folder_upload.report.reason.${code}`), code).toContain("upload the folder again");
    }
  });

  it("reads the AMENDMENT 4 content-PUT codes as retryable (core 64c6520aa)", () => {
    const generic = failureReasonMessage(t, "no_such_code");
    for (const code of ["folder_upload_file_settled", "folder_upload_target_signed", "upload_session_busy"]) {
      expect(failureReasonMessage(t, code), code).not.toBe(generic);
      expect(failureReasonMessage(t, code), code).toContain("Thử lại các tệp lỗi");
      expect(failureReasonMessage(en, code), code).toContain("Retry the failed files");
      // Nothing about re-uploading: the runner retries them.
      expect(failureReasonMessage(t, code), code).not.toMatch(/tải lại thư mục|không tải lên lại được/);
    }
    expect(failureReasonMessage(t, "folder_upload_target_signed")).toContain("kho lưu trữ");
    expect(failureReasonMessage(en, "folder_upload_target_signed")).toContain("storage");
    expect(runErrorMessage(t, refused("folder_upload_target_signed"), "vi")).not.toMatch(/tải lại thư mục/);
    expect(runErrorMessage(t, refused("folder_upload_file_settled"), "vi")).not.toMatch(/không tải lên lại được/);
  });

  it("reads an unknown code the runner marked retryable as the generic retry sentence (core FX4: storage_unavailable)", () => {
    const retryable = (tt: typeof t, code: string) => failureReasonMessage(tt, code, undefined, "folder", true, true);
    for (const code of ["storage_unavailable", "http_5xx_future", undefined]) {
      expect(retryable(t, code as string), String(code)).toContain("Thử lại các tệp lỗi");
      expect(retryable(en, code as string), String(code)).toContain("Retry the failed files");
    }
    // Not retryable, or the report has no retry button: the plain sentence, no pointer at a button.
    for (const [canRetry, flag] of [[true, false], [false, true], [false, false]] as const) {
      const plain = failureReasonMessage(t, "storage_unavailable", undefined, "folder", canRetry, flag);
      expect(plain).toBe(failureReasonMessage(t, "no_such_code"));
      expect(plain).not.toMatch(/Thử lại/);
    }
    // A known code keeps its own sentence whatever the flag says.
    expect(failureReasonMessage(t, "network", undefined, "folder", true, true)).toBe(failureReasonMessage(t, "network"));
  });

  it("points at no retry button when the report cannot retry (R2-3)", () => {
    for (const code of ["network", "target_expired", "http_5xx", "http_503", "missing_part_url", "aborted", "parts_invalid", "upload_session_busy", "folder_upload_file_settled", "folder_upload_target_signed"]) {
      for (const tt of [t, en]) {
        const message = failureReasonMessage(tt, code, undefined, "folder", false);
        expect(message, code).not.toMatch(/Thử lại|Retry|Try again/);
        expect(message, code).not.toBe(failureReasonMessage(tt, "no_such_code"));
      }
    }
    // A final sentence keeps its own advice.
    expect(failureReasonMessage(t, "storage_quota_exceeded", undefined, "folder", false)).toContain("tải lại thư mục");
  });

  it("says why an unsupported_media file was refused when the server gave a reason", () => {
    expect(failureReasonMessage(t, "unsupported_media", "zip_unreadable")).not.toBe(
      failureReasonMessage(t, "unsupported_media"),
    );
    expect(failureReasonMessage(t, "unsupported_media", "something_new")).toBe(
      failureReasonMessage(t, "unsupported_media"),
    );
  });
});

describe("refusalMessage", () => {
  it("names the folder count of the too_many_folders refusal", () => {
    expect(refusalMessage(t, { code: "too_many_folders", limit: 500, actual: 530 } as never, "vi")).toBe(
      "530 thư mục — tối đa 500",
    );
  });

  it("reads a lower bound as 'hơn N' when a dropped folder was cut at the read bound", () => {
    const refusal = { code: "too_many_files", limit: 500, actual: 2000 } as never;
    expect(refusalMessage(t, refusal, "vi", { lowerBound: true })).toBe("Hơn 2.000 tệp — tối đa 500");
    expect(refusalMessage(t, refusal, "vi")).toBe("2.000 tệp — tối đa 500");
    expect(en("documents.folder_upload.refusal.too_many_files_over", { actual: "2,000", limit: "500" })).toBe(
      "Over 2,000 files — 500 at most",
    );
    // Only the file count has a lower-bound reading.
    expect(refusalMessage(t, { code: "too_deep", limit: 20, actual: 21 } as never, "vi", { lowerBound: true })).toBe(
      "Sâu 21 cấp — tối đa 20",
    );
  });
});

// ADDENDUM 2 A7: a files-mode run has no folder, so no sentence may tell the
// person to upload "the folder" again; the folder mode keeps its sentences.
describe("files-mode copy", () => {
  const FINAL = ["unsupported_media", "storage_quota_exceeded", "not_found", "untrusted_target"];
  const RUN = [
    "folder_upload_target_signed",
    "idempotency_payload_mismatch",
    "folders_busy",
    "folder_uploads_busy",
    "document_too_deep",
    "folder_upload_too_many_files",
    "folder_upload_too_large",
    "invalid_request",
    "http_403",
    "http_404",
    "no_such_code",
  ];

  it("says to upload the files again in files mode and the folder again in folder mode", () => {
    for (const code of FINAL) {
      expect(failureReasonMessage(t, code, undefined, "files"), code).toContain("tải lại tệp");
      expect(failureReasonMessage(t, code, undefined, "files"), code).not.toContain("thư mục");
      expect(failureReasonMessage(en, code, undefined, "files"), code).not.toMatch(/folder/i);
      expect(failureReasonMessage(t, code, undefined, "folder"), code).toContain("tải lại thư mục");
    }
    expect(failureReasonMessage(t, "unsupported_media", "zip_unreadable", "files")).toContain("tải lại tệp");
    expect(failureReasonMessage(en, "unsupported_media", "zip_unreadable", "files")).not.toMatch(/folder/i);
  });

  it("never asks for the folder again in a files-mode run error", () => {
    for (const code of RUN) {
      for (const [tt, locale] of [[t, "vi"], [en, "en"]] as const) {
        const message = runErrorMessage(tt, refused(code, { max_depth: 20, max: 500, count: 612 }), locale, "files");
        expect(message, `${locale} ${code}`).not.toMatch(/(tải lại|chọn lại) thư mục|tải thư mục|folder again|folder uploads/i);
      }
    }
    expect(runErrorMessage(t, refused("idempotency_payload_mismatch"), "vi", "files")).toContain("chọn lại tệp");
    expect(runErrorMessage(t, refused("idempotency_payload_mismatch"), "vi")).toContain("chọn lại thư mục");
  });

  // review-fe-r3 R3-4: the unnamed invalid_request sentence has a files variant too.
  it("never names a folder in the unnamed files-mode invalid_request sentence", () => {
    const vi = runErrorMessage(t, refused("invalid_request", {}), "vi", "files");
    expect(vi).toBe("Tên tệp không hợp lệ. Hãy đổi tên rồi thử lại.");
    expect(vi).not.toContain("thư mục");
    expect(runErrorMessage(en, refused("invalid_request", {}), "en", "files")).not.toMatch(/folder/i);
    expect(runErrorMessage(t, refused("invalid_request", {}), "vi")).toContain("thư mục");
  });

  it("names the files, not a folder, in a files-mode refusal", () => {
    expect(refusalMessage(t, { code: "nothing_to_upload" }, "vi", { mode: "files" })).toBe("Không có tệp nào tải lên được.");
    expect(refusalMessage(t, { code: "too_deep", limit: 20, actual: 21 }, "vi", { mode: "files" })).toBe(
      "Tệp sẽ nằm ở cấp 21 — tối đa 20",
    );
    expect(refusalMessage(t, { code: "too_many_files", limit: 500, actual: 612 }, "vi", { mode: "files" })).toBe("612 tệp — tối đa 500");
  });
});

describe("folder-upload copy typography (R2-5)", () => {
  it("quotes names with straight double quotes in Vietnamese (docs/conventions.md §3)", () => {
    const vi = JSON.stringify(t("documents.folder_upload", { returnObjects: true }));
    expect(vi).not.toMatch(/[«»“”]/);
    expect(t("documents.folder_upload.toast.success", { count: 2, name: "Mới" })).toBe('Đã tải lên 2 tệp vào "Mới"');
  });
});

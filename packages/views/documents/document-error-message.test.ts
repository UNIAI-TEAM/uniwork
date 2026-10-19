import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { ChunkedUploadError } from "@uniwork/core/documents/chunked-upload";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import { initI18n } from "@uniwork/core/i18n";
import { documentErrorMessage, documentUploadValidationMessage } from "./document-error-message";

type T = Parameters<typeof documentErrorMessage>[1];

function fakeT() {
  return vi.fn((key: string, opts?: Record<string, unknown>) =>
    opts ? `${key}|${JSON.stringify(opts)}` : key,
  ) as unknown as T & ReturnType<typeof vi.fn>;
}

describe("documentErrorMessage", () => {
  it("maps folder_name_taken to its own sentence", () => {
    const t = fakeT();
    const msg = documentErrorMessage(new ApiError("taken", "folder_name_taken", 409), t, "fallback");
    expect(msg.split("|")[0]).toBe("documents.errors.folder_name_taken");
  });

  it("passes the shared depth limit to the too-deep sentence", () => {
    const t = fakeT();
    documentErrorMessage(new ApiError("deep", "document_too_deep", 422), t, "fallback");
    expect(t).toHaveBeenCalledWith("documents.errors.document_too_deep", { max: TREE_MAX_LEVEL });
  });

  it("keeps the server message for an uncoded failure, then the fallback", () => {
    const t = fakeT();
    expect(documentErrorMessage(new ApiError("Nope", "something_else", 400), t, "fallback")).toBe("Nope");
    expect(documentErrorMessage(undefined, t, "fallback")).toBe("fallback");
  });

  it("reads error.fields.max_bytes for a 413 file_too_large error", () => {
    const t = fakeT();
    const err = new ApiError("too large", "file_too_large", 413, undefined, {
      max_bytes: 50 * 1024 * 1024,
    });
    documentErrorMessage(err, t, "fallback", {
      locale: "vi",
      file: { name: "Report.docx", size: 60 * 1024 * 1024 },
    });
    expect(t).toHaveBeenCalledWith("documents.upload.too_large_named", {
      name: "Report.docx",
      size: "60 MB",
      max: "50 MB",
    });

    const tNoFile = fakeT();
    documentErrorMessage(err, tNoFile, "fallback", { locale: "en" });
    expect(tNoFile).toHaveBeenCalledWith("documents.errors.file_too_large", {
      max: "50 MB",
    });
  });

  it("formats pre-upload size and extension failures in vi and en", () => {
    const i18n = initI18n();
    const tVi = i18n.getFixedT("vi");
    const tEn = i18n.getFixedT("en");
    const maxBytes = 200 * 1024 * 1024;

    expect(documentUploadValidationMessage({ name: "ok.docx", size: maxBytes }, maxBytes, tVi, "vi")).toBeNull();

    expect(
      documentUploadValidationMessage({ name: "Report.docx", size: maxBytes + 1 }, maxBytes, tVi, "vi"),
    ).toBe(
      "Report.docx nặng 200,1 MB, vượt giới hạn 200 MB. Giảm dung lượng ảnh hoặc chia nhỏ tệp rồi tải lên lại.",
    );

    expect(
      documentUploadValidationMessage({ name: "Report.docx", size: maxBytes + 1 }, maxBytes, tEn, "en"),
    ).toBe(
      "Report.docx is 200.1 MB, which is over the 200 MB limit. Reduce image sizes or split the file, then upload again.",
    );

    expect(documentUploadValidationMessage({ name: "bad.exe", size: 128 }, maxBytes, tVi, "vi")).toBe(
      "Định dạng của bad.exe chưa được hỗ trợ.",
    );
  });

  it("maps upload session error codes and quota_exceeded to localized messages in vi and en", () => {
    const i18n = initI18n();
    const tVi = i18n.getFixedT("vi");
    const tEn = i18n.getFixedT("en");

    for (const code of [
      "upload_sessions_exhausted",
      "upload_session_expired",
      "upload_parts_invalid",
      "upload_size_mismatch",
      "upload_probe_mismatch",
      "quota_exceeded",
    ]) {
      const err = new ApiError("server fallback", code, 422);
      const viMsg = documentErrorMessage(err, tVi, "documents.page.upload_failed", { locale: "vi" });
      const enMsg = documentErrorMessage(err, tEn, "documents.page.upload_failed", { locale: "en" });
      expect(viMsg).not.toBe("server fallback");
      expect(viMsg).not.toBe(`documents.errors.${code}`);
      expect(enMsg).not.toBe("server fallback");
      expect(enMsg).not.toBe(`documents.errors.${code}`);
    }
  });

  it("maps 415 unsupported_media_type with and without file context", () => {
    const t = fakeT();
    const err = new ApiError("unsupported", "unsupported_media_type", 415);
    documentErrorMessage(err, t, "fallback", {
      file: { name: "bad.bin", size: 1024 },
    });
    expect(t).toHaveBeenCalledWith("documents.upload.unsupported_format", { name: "bad.bin" });

    const tNoFile = fakeT();
    documentErrorMessage(err, tNoFile, "fallback");
    expect(tNoFile.mock.calls[0]?.[0]).toBe("documents.errors.unsupported_media_type");
  });

  it("maps 415 unsupported_media_type with reason zip_unreadable to damaged-file copy in vi and en (V-2)", () => {
    const i18n = initI18n();
    const tVi = i18n.getFixedT("vi");
    const tEn = i18n.getFixedT("en");
    const err = new ApiError("unsupported", "unsupported_media_type", 415, undefined, {
      reason: "zip_unreadable",
    });
    const file = { name: "corrupt30.docx", size: 30 * 1024 * 1024 };

    expect(documentErrorMessage(err, tVi, "fallback", { locale: "vi", file })).toBe(
      "Không đọc được tệp corrupt30.docx. Tệp có thể bị hỏng.",
    );
    expect(documentErrorMessage(err, tEn, "fallback", { locale: "en", file })).toBe(
      "Couldn't read corrupt30.docx. The file may be damaged.",
    );
  });

  it("maps 423 document_locked to localized copy in vi and en instead of the raw server sentence (V-7)", () => {
    const i18n = initI18n();
    const tVi = i18n.getFixedT("vi");
    const tEn = i18n.getFixedT("en");
    const err = new ApiError("tài liệu đang được người khác sửa", "document_locked", 423, undefined, {
      holder_name: "An",
    });

    expect(documentErrorMessage(err, tVi, "documents.file.commit_failed", { locale: "vi" })).toBe(
      "Tài liệu này đang được người khác sửa. Chờ họ lưu xong hoặc lấy quyền sửa rồi thử lại.",
    );
    expect(documentErrorMessage(err, tEn, "documents.file.commit_failed", { locale: "en" })).toBe(
      "Someone else is editing this document. Wait until they finish or take over editing, then try again.",
    );
  });

  it("maps a failed upload with an open resumable session to documents.upload.failed_resumable", () => {
    const t = fakeT();
    documentErrorMessage(new Error("network timeout"), t, "fallback", { resumable: true });
    expect(t).toHaveBeenCalledWith("documents.upload.failed_resumable");
  });

  // RAR-15: a chunked version upload refused at session create must not offer
  // to "resume" a write the server can never accept.
  it("maps a 409 document_shelved with an open resumable session to documents.shelved_doc.write_blocked (RAR-15)", () => {
    const t = fakeT();
    documentErrorMessage(
      new ApiError("document is shelved", "document_shelved", 409, undefined, undefined, "read_only"),
      t,
      "fallback",
      { resumable: true },
    );
    expect(t).toHaveBeenCalledWith("documents.shelved_doc.write_blocked");
    expect(t).not.toHaveBeenCalledWith("documents.upload.failed_resumable");
  });

  it("maps ChunkedUploadError(central_directory_too_large) with and without file context, and maps missing_etag / malformed_response through resumable or fallback", () => {
    const errCd = new ChunkedUploadError(
      "central_directory_too_large",
      "ZIP central directory exceeds 1 MiB",
    );
    const tWithFile = fakeT();
    documentErrorMessage(errCd, tWithFile, "fallback", {
      file: { name: "huge.docx", size: 30 * 1024 * 1024 },
      resumable: true,
    });
    expect(tWithFile).toHaveBeenCalledWith("documents.upload.unsupported_format", {
      name: "huge.docx",
    });

    const tNoFile = fakeT();
    documentErrorMessage(errCd, tNoFile, "fallback");
    expect(tNoFile.mock.calls[0]?.[0]).toBe("documents.errors.unsupported_media_type");

    const tResumable = fakeT();
    documentErrorMessage(
      new ChunkedUploadError("missing_etag", "Missing ETag on part 1"),
      tResumable,
      "fallback",
      { resumable: true },
    );
    expect(tResumable).toHaveBeenCalledWith("documents.upload.failed_resumable");

    const tFallback = fakeT();
    documentErrorMessage(
      new ChunkedUploadError("malformed_response", "Malformed response"),
      tFallback,
      "documents.home.drop_failed",
      { fallbackOpts: { name: "huge.docx" } },
    );
    expect(tFallback).toHaveBeenCalledWith("documents.home.drop_failed", {
      name: "huge.docx",
    });
  });
});



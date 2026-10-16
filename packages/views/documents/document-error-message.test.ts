import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
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
});


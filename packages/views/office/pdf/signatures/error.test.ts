import { renderHook } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { pdfSignatureErrorMessage } from "./error";
import { PdfSignatureFileError } from "./image-file";
import { SavedSignatureRequestError } from "./hooks";

const translator = () => renderHook(() => useTranslation()).result.current.t;

describe("pdfSignatureErrorMessage", () => {
  it("localizes each local file failure", () => {
    expect(pdfSignatureErrorMessage(new PdfSignatureFileError("file_type", "x"), translator())).toBe("Chọn ảnh PNG hoặc JPEG.");
    expect(pdfSignatureErrorMessage(new PdfSignatureFileError("file_too_large", "x"), translator())).toContain("512 KiB");
    expect(pdfSignatureErrorMessage(new PdfSignatureFileError("image_mismatch", "x"), translator())).toBe("Ảnh không khớp với định dạng đã khai báo.");
    expect(pdfSignatureErrorMessage(new PdfSignatureFileError("file_unreadable", "x"), translator())).toBe("Không thể đọc ảnh chữ ký.");
  });

  it("maps endpoint failures by status and code", () => {
    expect(pdfSignatureErrorMessage({ status: 400, code: "invalid_request" }, translator())).toBe("Máy chủ từ chối ảnh chữ ký này.");
    expect(pdfSignatureErrorMessage({ status: 403 }, translator())).toBe("Bạn không có quyền lưu chữ ký trong tổ chức này.");
    expect(pdfSignatureErrorMessage({ status: 404 }, translator())).toBe("Chữ ký này không còn nữa.");
  });

  it("falls back to the generic save sentence", () => {
    expect(pdfSignatureErrorMessage(new Error("boom"), translator())).toBe("Không thể lưu chữ ký. Thử lại.");
    expect(pdfSignatureErrorMessage(new SavedSignatureRequestError("unusable_response", "x"), translator())).toBe("Không thể lưu chữ ký. Thử lại.");
  });
});

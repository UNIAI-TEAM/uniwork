import { renderHook } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { PdfStampProviderError } from "./provider";
import { pdfStampErrorMessage } from "./stamp-error";
import { PdfStampImageError } from "./stamp-image";

const translator = () => renderHook(() => useTranslation()).result.current.t;

describe("pdfStampErrorMessage", () => {
  it("localizes each local file failure", () => {
    expect(pdfStampErrorMessage(new PdfStampImageError("file_type", "x"), translator())).toBe("Chọn ảnh PNG hoặc JPEG.");
    expect(pdfStampErrorMessage(new PdfStampImageError("file_too_large", "x"), translator())).toBe("Ảnh con dấu quá lớn để đóng.");
    expect(pdfStampErrorMessage(new PdfStampImageError("file_unreadable", "x"), translator())).toBe("Không thể đọc ảnh con dấu.");
  });

  it("maps an unsupported engine seam to its own sentence", () => {
    expect(pdfStampErrorMessage(new PdfStampProviderError("unsupported_operation", "x"), translator())).toBe("Engine PDF hiện tại chưa đóng được con dấu.");
    expect(pdfStampErrorMessage({ code: "unsupported_operation" }, translator())).toBe("Engine PDF hiện tại chưa đóng được con dấu.");
    expect(pdfStampErrorMessage(new PdfStampProviderError("invalid_input", "x"), translator())).toBe("Vị trí đóng dấu không hợp lệ.");
  });

  it("falls back to the generic placement sentence", () => {
    expect(pdfStampErrorMessage(new Error("boom"), translator())).toBe("Không thể đóng dấu. Thử lại.");
  });
});

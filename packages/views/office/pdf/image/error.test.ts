import { renderHook } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { pdfImageErrorMessage } from "./error";
import { PdfImageProviderError } from "./provider";

const translator = () => renderHook(() => useTranslation()).result.current.t;

describe("pdfImageErrorMessage", () => {
  it("maps a vanished selection to its own sentence", () => {
    const error = new PdfImageProviderError("object_unavailable", "selected image object could not be resolved");
    expect(pdfImageErrorMessage(error, translator())).toBe("Nội dung đã chọn không còn khả dụng. Chọn lại.");
  });

  it("maps an asset-shaped failure to the image read sentence", () => {
    expect(pdfImageErrorMessage({ code: "asset_unavailable" }, translator())).toBe("Không thể đọc ảnh.");
  });

  it("falls back to the generic failure sentence", () => {
    expect(pdfImageErrorMessage(new Error("boom"), translator())).toBe("Không thể áp dụng thay đổi PDF. Thử lại.");
  });
});

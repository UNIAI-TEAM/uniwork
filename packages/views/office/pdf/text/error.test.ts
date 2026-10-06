import { renderHook } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { PdfOpsBridgeError } from "../ops-bridge";
import { pdfTextErrorMessage } from "./error";

const translator = () => renderHook(() => useTranslation()).result.current.t;

describe("pdfTextErrorMessage", () => {
  it("reads a font name from an EngineBoundaryError instance", () => {
    const error = new EngineBoundaryError("engine_result_invalid", { reason: "font_fallback_missing", font: "Noto Sans" });
    expect(pdfTextErrorMessage(error, translator())).toBe("Thiếu font nhúng: Noto Sans. Engine không âm thầm thay thế font này.");
  });

  it("reads a font name from the flat wire body", () => {
    const error = new EngineBoundaryError("engine_result_invalid", { reason: "font_fallback_missing", font: "Noto Sans" });
    const t = translator();
    expect(pdfTextErrorMessage(JSON.parse(JSON.stringify(error)), t)).toBe(pdfTextErrorMessage(error, t));
  });

  it("joins every missing font name", () => {
    const error = new EngineBoundaryError("engine_result_invalid", { reason: "font_fallback_missing", fonts: ["Lora", "Noto Sans"] });
    expect(pdfTextErrorMessage(error, translator())).toContain("Lora, Noto Sans");
  });

  it("never interpolates the generic failure sentence into the font copy", () => {
    const error = new EngineBoundaryError("engine_result_invalid", { reason: "font_fallback_missing" });
    const message = pdfTextErrorMessage(error, translator());
    expect(message).toBe("Thiếu font nhúng; engine không âm thầm thay thế font.");
    expect(message).not.toContain("Không thể áp dụng thay đổi PDF");
  });

  it("maps a missing object resolver to its own sentence", () => {
    const error = new PdfOpsBridgeError("object_unavailable", "replace_text", "object resolver is required");
    expect(pdfTextErrorMessage(error, translator())).toBe("Nội dung đã chọn không còn khả dụng. Chọn lại.");
  });

  it("falls back to the generic failure sentence", () => {
    expect(pdfTextErrorMessage(new Error("boom"), translator())).toBe("Không thể áp dụng thay đổi PDF. Thử lại.");
  });
});

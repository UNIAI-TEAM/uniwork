// Parity: the cases of packages/views/chat/chat-file-accept.test.ts, with the
// picker's asset ({ name, mimeType, size }) where the web has a DOM File.
import { describe, expect, it } from "vitest";
import {
  CHAT_FILE_MAX_BYTES,
  isChatAcceptedFile,
  isChatFileTooLarge,
  isChatImageContentType,
  isChatImageFile,
  isChatPdfContentType,
  resolveChatFileContentType,
} from "./file-accept";

const file = (name: string, mimeType?: string, size = 1) => ({ name, mimeType, size });

describe("file-accept", () => {
  it("accepts allowlisted MIME and extension fallbacks", () => {
    expect(isChatAcceptedFile(file("a.png", "image/png"))).toBe(true);
    expect(isChatAcceptedFile(file("a.pdf", "application/pdf"))).toBe(true);
    expect(isChatAcceptedFile(file("plan.docx", ""))).toBe(true);
    expect(
      isChatAcceptedFile(file("sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
    ).toBe(true);
    expect(isChatAcceptedFile(file("a.PDF"))).toBe(true);
    expect(isChatAcceptedFile(file("a.exe", "application/octet-stream"))).toBe(false);
    expect(isChatAcceptedFile(file("README", ""))).toBe(false);
  });

  it("detects PDF content types", () => {
    expect(isChatPdfContentType("application/pdf")).toBe(true);
    expect(isChatPdfContentType("image/png")).toBe(false);
  });

  it("infers image type from filename when content_type is empty", () => {
    expect(resolveChatFileContentType({ filename: "photo.PNG", content_type: "" })).toBe("image/png");
    expect(resolveChatFileContentType({ content_type: " text/plain " })).toBe("text/plain");
    expect(resolveChatFileContentType({ filename: "notes" })).toBeUndefined();
    expect(resolveChatFileContentType({})).toBeUndefined();
    expect(isChatImageContentType(undefined, "shot.jpg")).toBe(true);
    expect(isChatImageContentType(undefined)).toBe(false);
  });

  it("treats a file past 25 MB as too large", () => {
    expect(isChatFileTooLarge(file("a.pdf", "application/pdf", 1))).toBe(false);
    expect(isChatFileTooLarge(file("a.pdf", "application/pdf", CHAT_FILE_MAX_BYTES + 1))).toBe(true);
    // A picker that reports no size cannot be judged here; the server refuses it.
    expect(isChatFileTooLarge({ name: "a.pdf" })).toBe(false);
  });

  it("detects image files in the composer from type or name", () => {
    expect(isChatImageFile(file("Screenshot.png", "image/png"))).toBe(true);
    expect(isChatImageFile(file("IMG_1.HEIC.jpg"))).toBe(true);
    expect(isChatImageFile(file("doc.pdf", "application/pdf"))).toBe(false);
  });
});

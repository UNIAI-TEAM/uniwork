import { describe, expect, it } from "vitest";
import {
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_DOCUMENT_SHAREABLE_TYPES,
  CHAT_FILE_MAX_BYTES,
  isChatAcceptedFile,
  isChatDocumentShareableFile,
  isChatDocumentTooLarge,
  isChatFileTooLarge,
  isChatImageContentType,
  isChatImageFile,
  isChatPdfContentType,
  pickChatAcceptedFiles,
  resolveChatFileContentType,
} from "./chat-file-accept";

describe("chat-file-accept", () => {
  it("accepts allowlisted MIME and extension fallbacks", () => {
    expect(
      isChatAcceptedFile(new File(["x"], "a.png", { type: "image/png" })),
    ).toBe(true);
    expect(
      isChatAcceptedFile(new File(["x"], "a.pdf", { type: "application/pdf" })),
    ).toBe(true);
    expect(isChatAcceptedFile(new File(["x"], "plan.docx", { type: "" }))).toBe(true);
    expect(
      isChatAcceptedFile(
        new File(["x"], "sheet.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      ),
    ).toBe(true);
    expect(isChatAcceptedFile(new File(["x"], "a.PDF", { type: "" }))).toBe(
      true,
    );
    expect(
      isChatAcceptedFile(new File(["x"], "a.exe", { type: "application/octet-stream" })),
    ).toBe(false);
  });

  it("filters a FileList-like iterable", () => {
    const files = [
      new File(["1"], "ok.png", { type: "image/png" }),
      new File(["2"], "no.zip", { type: "application/zip" }),
    ];
    expect(pickChatAcceptedFiles(files).map((f) => f.name)).toEqual(["ok.png"]);
  });

  it("detects PDF content types", () => {
    expect(isChatPdfContentType("application/pdf")).toBe(true);
    expect(isChatPdfContentType("image/png")).toBe(false);
  });

  it("infers image type from filename when content_type is empty", () => {
    expect(resolveChatFileContentType({ filename: "photo.PNG", content_type: "" })).toBe("image/png");
    expect(isChatImageContentType(undefined, "shot.jpg")).toBe(true);
  });

  it("treats a file past 25 MB as too large", () => {
    const small = new File(["x"], "a.pdf", { type: "application/pdf" });
    const large = new File(["x"], "a.pdf", { type: "application/pdf" });
    Object.defineProperty(large, "size", { value: CHAT_FILE_MAX_BYTES + 1 });
    expect(isChatFileTooLarge(small)).toBe(false);
    expect(isChatFileTooLarge(large)).toBe(true);
  });

  it("detects image files in the composer from type or name", () => {
    expect(isChatImageFile(new File([], "Screenshot.png", { type: "image/png" }))).toBe(true);
    expect(isChatImageFile(new File([], "doc.pdf", { type: "application/pdf" }))).toBe(false);
  });
});

// UNI-1966: the picker mirrors the server's documentMIMETypes
// (server/internal/files/registry.go); a Go parity test reads the exported
// table the same way TestChatFileAllowlistsAgree reads ALLOWED_MIME.
describe("chat document shareable allowlist", () => {
  it("accepts every document MIME and its extensions", () => {
    for (const { mime, exts } of CHAT_DOCUMENT_SHAREABLE_TYPES) {
      expect(isChatDocumentShareableFile(new File(["x"], "a.bin", { type: mime }))).toBe(true);
      for (const ext of exts) {
        expect(isChatDocumentShareableFile(new File(["x"], `a${ext}`, { type: "" }))).toBe(true);
      }
    }
  });

  it("covers the document formats the composer names", () => {
    for (const name of ["a.pdf", "a.docx", "a.xlsx", "a.pptx", "a.doc", "a.xls", "a.ppt", "a.odt", "a.md", "a.html", "a.txt"]) {
      expect(isChatDocumentShareableFile(new File(["x"], name, { type: "" }))).toBe(true);
    }
  });

  it("refuses archives, executables and files with no known shape", () => {
    expect(isChatDocumentShareableFile(new File(["x"], "a.zip", { type: "application/zip" }))).toBe(false);
    expect(isChatDocumentShareableFile(new File(["x"], "a.exe", { type: "application/octet-stream" }))).toBe(false);
    expect(isChatDocumentShareableFile(new File(["x"], "noext", { type: "" }))).toBe(false);
    expect(isChatDocumentShareableFile(new File(["x"], "a.doc", { type: "application/octet-stream" }))).toBe(true);
  });

  it("lets a document ride the document byte ceiling, not the chat one", () => {
    const mk = (size: number) => {
      const file = new File(["x"], "deck.pptx", { type: "application/vnd.ms-powerpoint" });
      Object.defineProperty(file, "size", { value: size });
      return file;
    };
    const big = mk(CHAT_FILE_MAX_BYTES + 1);
    expect(isChatFileTooLarge(big)).toBe(true);
    expect(isChatDocumentTooLarge(big)).toBe(false);
    expect(isChatDocumentTooLarge(mk(CHAT_DOCUMENT_MAX_BYTES + 1))).toBe(true);
  });
});

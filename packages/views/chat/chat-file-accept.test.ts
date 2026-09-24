import { describe, expect, it } from "vitest";
import {
  isChatAcceptedFile,
  isChatPdfContentType,
  pickChatAcceptedFiles,
} from "./chat-file-accept";

describe("chat-file-accept", () => {
  it("accepts allowlisted MIME and extension fallbacks", () => {
    expect(
      isChatAcceptedFile(new File(["x"], "a.png", { type: "image/png" })),
    ).toBe(true);
    expect(
      isChatAcceptedFile(new File(["x"], "a.pdf", { type: "application/pdf" })),
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
});

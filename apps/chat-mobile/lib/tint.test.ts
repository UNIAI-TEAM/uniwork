import { describe, expect, it } from "vitest";
import { fileBadge } from "./tint";

describe("fileBadge", () => {
  it("labels a known type with its tint, whatever the case", () => {
    expect(fileBadge("Thong-cao-bao-chi.docx")).toEqual({ label: "DOCX", tint: "blue" });
    expect(fileBadge("Ngan-sach.XLSX")).toEqual({ label: "XLSX", tint: "green" });
    expect(fileBadge("hop-dong.pdf")).toEqual({ label: "PDF", tint: "red" });
  });

  it("cuts a long extension to four letters and falls back to blue", () => {
    expect(fileBadge("dump.backup")).toEqual({ label: "BACK", tint: "blue" });
    expect(fileBadge("odd.constructor")).toEqual({ label: "CONS", tint: "blue" });
  });

  it("has no label without an extension, or for a dotfile", () => {
    expect(fileBadge("README")).toEqual({ label: "", tint: "blue" });
    expect(fileBadge(".env")).toEqual({ label: "", tint: "blue" });
    expect(fileBadge("")).toEqual({ label: "", tint: "blue" });
  });
});

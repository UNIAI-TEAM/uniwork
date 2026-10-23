import { describe, expect, it } from "vitest";
import { foldedIncludes, foldVi } from "./chat-search-fold";

describe("foldVi", () => {
  it("strips Vietnamese marks and đ", () => {
    expect(foldVi("Nguyễn Văn Đức")).toBe("nguyen van duc");
  });

  it("matches decomposed input against precomposed text", () => {
    expect(foldedIncludes("Tuấn", "Tuấn")).toBe(true);
  });

  it("finds unaccented queries and every word", () => {
    expect(foldedIncludes("Trần Minh Tuấn", "tuan tran")).toBe(true);
    expect(foldedIncludes("Trần Minh Tuấn", "tuan hoa")).toBe(false);
    expect(foldedIncludes("Anything", "  ")).toBe(true);
  });
});

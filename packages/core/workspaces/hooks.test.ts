import { describe, expect, it } from "vitest";
import { slugify } from "./hooks";

describe("slugify", () => {
  it("strips Vietnamese diacritics and lowercases", () => {
    expect(slugify("Đội Alpha số 1")).toBe("doi-alpha-so-1");
  });
  it("collapses separators and trims", () => {
    expect(slugify("  Hello   World!  ")).toBe("hello-world");
  });
});

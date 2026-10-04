import { describe, expect, it } from "vitest";
import { caseModeForToggle, transformCase } from "./case-transform";

describe("transformCase", () => {
  it("uppercases and lowercases the whole value", () => {
    expect(transformCase("Xin chào UniWork", "upper")).toBe("XIN CHÀO UNIWORK");
    expect(transformCase("Xin chào UniWork", "lower")).toBe("xin chào uniwork");
  });

  it("capitalises the first letter of every word in title mode", () => {
    expect(transformCase("xin chào uniwork", "title")).toBe("Xin Chào Uniwork");
  });

  it("capitalises sentence starts after terminators in sentence mode", () => {
    expect(transformCase("xin chào. uniwork chạy tốt! cảm ơn", "sentence")).toBe(
      "Xin chào. Uniwork chạy tốt! Cảm ơn",
    );
    expect(transformCase("câu một。câu hai", "sentence")).toBe("Câu một。Câu hai");
  });
});

describe("caseModeForToggle", () => {
  it("walks lowercase → UPPERCASE → Capitalize Each Word → lowercase", () => {
    expect(caseModeForToggle("hello")).toBe("upper");
    expect(caseModeForToggle("HELLO")).toBe("title");
    expect(caseModeForToggle("Hello")).toBe("lower");
  });

  it("enters the ring at lowercase for mixed-case text", () => {
    expect(caseModeForToggle("hELLO")).toBe("lower");
  });

  it("falls back to lowercase when the text has no letters", () => {
    expect(caseModeForToggle("123 !!!")).toBe("lower");
    expect(caseModeForToggle("")).toBe("lower");
  });
});

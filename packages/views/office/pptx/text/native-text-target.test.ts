import { describe, expect, it } from "vitest";
import { isNativeTextTarget } from "./native-text-target";

function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

describe("isNativeTextTarget", () => {
  it("accepts text-like inputs and textareas", () => {
    expect(isNativeTextTarget(el("<input>"))).toBe(true);
    expect(isNativeTextTarget(el('<input type="text">'))).toBe(true);
    expect(isNativeTextTarget(el('<input type="search">'))).toBe(true);
    expect(isNativeTextTarget(el("<textarea></textarea>"))).toBe(true);
  });

  it("rejects non-text inputs, selects and plain elements", () => {
    for (const type of ["checkbox", "radio", "button", "range", "color", "file", "submit"]) {
      expect(isNativeTextTarget(el(`<input type="${type}">`))).toBe(false);
    }
    expect(isNativeTextTarget(el("<select></select>"))).toBe(false);
    expect(isNativeTextTarget(el("<div></div>"))).toBe(false);
    expect(isNativeTextTarget(null)).toBe(false);
  });

  it("accepts contenteditable elements and their descendants", () => {
    expect(isNativeTextTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isNativeTextTarget(el('<div contenteditable=""></div>'))).toBe(true);
    expect(isNativeTextTarget(el('<div contenteditable="plaintext-only"></div>'))).toBe(true);
    const child = el('<div contenteditable="true"><span>x</span></div>').firstElementChild;
    expect(isNativeTextTarget(child)).toBe(true);
    expect(isNativeTextTarget(el('<div contenteditable="false"></div>'))).toBe(false);
  });
});

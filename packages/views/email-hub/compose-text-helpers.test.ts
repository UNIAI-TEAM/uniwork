import { describe, expect, it } from "vitest";
import { isImageUrl, plainTextToHtml } from "./compose-text-helpers";

describe("compose text helpers", () => {
  it("isImageUrl accepts common image extensions", () => {
    expect(isImageUrl("https://cdn.example.com/photo.jpg")).toBe(true);
    expect(isImageUrl("https://cdn.example.com/photo.png?v=1")).toBe(true);
    expect(isImageUrl("https://cdn.example.com/page.html")).toBe(false);
  });

  it("plainTextToHtml renders markdown and bare image URLs as img tags", () => {
    const html = plainTextToHtml("hello\n![](https://cdn.example.com/a.png)\nhttps://cdn.example.com/b.jpg");
    expect(html).toContain("hello");
    expect(html).toContain('<img src="https://cdn.example.com/a.png"');
    expect(html).toContain('<img src="https://cdn.example.com/b.jpg"');
  });

  it("plainTextToHtml keeps plain formatting markers", () => {
    expect(plainTextToHtml("*bold*")).toContain("<strong>bold</strong>");
  });
});

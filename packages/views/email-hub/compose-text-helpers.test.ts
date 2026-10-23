import { describe, expect, it } from "vitest";
import { isImageUrl, plainTextToHtml, readFileAsBase64 } from "./compose-text-helpers";

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

  it("leaves underscores and asterisks inside words, URLs and addresses alone", () => {
    const html = plainTextToHtml("Xem https://x.vn/a?utm_source=mail&utm_medium=hub và file bao_gia_v2.pdf, 5*3*2, gửi a_b@x.vn");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<strong>");
    expect(html).toContain('<a href="https://x.vn/a?utm_source=mail&amp;utm_medium=hub">');
    expect(html).toContain("bao_gia_v2.pdf");
  });

  it("formats markers that wrap whole words", () => {
    const html = plainTextToHtml("Rất *quan trọng* và _gấp_, <u>đọc kỹ</u>.");
    expect(html).toContain("<strong>quan trọng</strong>");
    expect(html).toContain("<em>gấp</em>");
    expect(html).toContain("<u>đọc kỹ</u>");
  });

  it("escapes HTML the writer typed", () => {
    expect(plainTextToHtml("<script>x</script>")).not.toContain("<script>");
  });

  it("readFileAsBase64 encodes the file bytes", async () => {
    const file = new File([new Uint8Array([104, 105])], "a.txt");
    await expect(readFileAsBase64(file)).resolves.toBe("aGk=");
  });
});

import { describe, expect, it } from "vitest";
import { commentPreviewText } from "./comment-preview-text";

describe("commentPreviewText", () => {
  it("bỏ dấu đậm", () => {
    expect(commentPreviewText("việc này **gấp** lắm")).toBe("việc này gấp lắm");
  });

  it("bỏ dấu nghiêng", () => {
    expect(commentPreviewText("việc này _gấp_ lắm")).toBe("việc này gấp lắm");
  });

  it("liên kết giữ nhãn, bỏ URL", () => {
    expect(commentPreviewText("xem [tài liệu](https://example.com/doc)")).toBe(
      "xem tài liệu",
    );
  });

  it("code span giữ chữ", () => {
    expect(commentPreviewText("chạy `npm run build` trước")).toBe(
      "chạy npm run build trước",
    );
  });

  it("khối code biến mất", () => {
    expect(commentPreviewText("trước\n```js\nconst a = 1;\n```\nsau")).toBe(
      "trước sau",
    );
  });

  it("tiêu đề bị bỏ", () => {
    expect(commentPreviewText("## Tiêu đề\nnội dung")).toBe("Tiêu đề nội dung");
  });

  it("dấu đầu dòng bị bỏ", () => {
    expect(commentPreviewText("- việc một\n- việc hai")).toBe(
      "việc một việc hai",
    );
  });

  it("nhiều dòng gộp thành một", () => {
    expect(commentPreviewText("dòng một\ndòng hai\n\ndòng ba")).toBe(
      "dòng một dòng hai dòng ba",
    );
  });

  it("chuỗi dài bị cắt kèm dấu ba chấm", () => {
    const long = "a".repeat(150);
    const result = commentPreviewText(long);
    expect(result.length).toBe(120);
    expect(result.endsWith("…")).toBe(true);
  });

  it("chuỗi chỉ gồm một khối code trả về chuỗi rỗng", () => {
    expect(commentPreviewText("```js\nconst a = 1;\n```")).toBe("");
  });

  it("bảng: bỏ hàng kẻ ngang, nối ô bằng dấu ·", () => {
    expect(
      commentPreviewText("| Col1 | Col2 |\n| --- | --- |\n| a | b |"),
    ).toBe("Col1 · Col2 a · b");
  });

  it("tệp đính kèm giữ tên tệp, bỏ cú pháp !file[...](...)", () => {
    expect(
      commentPreviewText("xem !file[report.pdf](https://cdn.example.com/report.pdf) nhé"),
    ).toBe("xem report.pdf nhé");
  });

  it("danh sách có số bị bỏ dấu thứ tự", () => {
    expect(commentPreviewText("1. một\n2. hai")).toBe("một hai");
  });

  it("bỏ dấu tô sáng ==...==", () => {
    expect(commentPreviewText("việc này ==gấp== lắm")).toBe("việc này gấp lắm");
  });
});

import { describe, expect, it } from "vitest";
import { asNode, docLayout, docProps, isAiSection, nodeText, splitTimes } from "./minutes-model";

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const list = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((s) => ({ type: "listItem", content: [para(s)] })),
});
const h = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

describe("minutes model", () => {
  it("splits the page's times off a line, in both layouts", () => {
    expect(splitTimes("Khóa tính năng ngày 30/10. (lúc 09:06, 09:07)")).toEqual({
      text: "Khóa tính năng ngày 30/10.",
      times: ["09:06", "09:07"],
    });
    expect(splitTimes("Feature freeze (at 9:06)")).toEqual({ text: "Feature freeze", times: ["9:06"] });
    expect(splitTimes("Giờ họp (lúc nào?)")).toEqual({ text: "Giờ họp (lúc nào?)", times: [] });
  });

  it("reads the opening list as properties only when every item is one", () => {
    expect(docProps(asNode(list("Thời gian: 09:00 – 09:28", "Chủ trì: Lan Phạm"))!)).toEqual([
      { label: "Thời gian", value: "09:00 – 09:28" },
      { label: "Chủ trì", value: "Lan Phạm" },
    ]);
    expect(docProps(asNode(list("Chủ trì: Lan", "một ý thường"))!)).toBeNull();
    expect(docProps(asNode(para("Chủ trì: Lan"))!)).toBeNull();
  });

  it("cuts the page into properties, sections and the closing line", () => {
    const layout = docLayout({
      type: "doc",
      content: [list("Chủ trì: Lan"), h(2, "Thành phần"), para("Có mặt 3/3."), h(3, "Chủ đề (lúc 09:01)"), h(2, "Kết luận"), list("Một"), para("Người lập: Hà")],
    });
    expect(layout.props).toEqual([{ label: "Chủ trì", value: "Lan" }]);
    expect(layout.sections.map((s) => [s.heading && nodeText(s.heading), s.blocks.length])).toEqual([
      ["Thành phần", 2],
      ["Kết luận", 1],
    ]);
    expect(layout.foot && nodeText(layout.foot)).toBe("Người lập: Hà");
  });

  it("keeps a page without headings whole, and survives what is not a page", () => {
    const plain = docLayout({ type: "doc", content: [para("Một"), para("Hai")] });
    expect(plain.foot).toBeNull();
    expect(plain.sections).toHaveLength(1);
    expect(plain.sections[0]!.blocks).toHaveLength(2);
    expect(docLayout(null)).toEqual({ props: null, sections: [], foot: null });
    expect(docLayout({ type: "doc", content: [42, { text: "no type" }, { type: "paragraph", content: "x", marks: [1, { type: "bold" }] }] }).sections[0]!.blocks).toEqual([
      { type: "paragraph", text: undefined, attrs: undefined, marks: [{ type: "bold", attrs: undefined }], content: undefined },
    ]);
  });

  it("knows the AI section by its heading in either layout", () => {
    expect(isAiSection(" Nội dung ")).toBe(true);
    expect(isAiSection("Discussion")).toBe(true);
    expect(isAiSection("Kết luận")).toBe(false);
  });
});

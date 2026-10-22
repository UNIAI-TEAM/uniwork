import { describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { actionItemTaskDescription } from "./action-item-task-description";

const t = () => getI18n().t;
const said = { kind: "segment", id: "g1", author: "Minh Anh", text: "Anh Hùng gửi báo giá\ncho khách *trước* thứ Sáu", at: "2026-10-22T03:32:00Z" };
const noted = { kind: "note", id: "n1", author: null, text: "Báo giá theo mẫu Q4", at: null };

describe("actionItemTaskDescription", () => {
  it("puts the AI's prose first, then each cited line quoted with who, where and when", () => {
    const text = actionItemTaskDescription("Gửi báo giá cho khách trước thứ Sáu.", [said, noted], t(), "vi-VN", "UTC");
    expect(text).toBe(
      [
        "Gửi báo giá cho khách trước thứ Sáu.",
        "",
        "**Căn cứ trong cuộc họp**",
        "",
        "> **Minh Anh** · Lời nói · 03:32",
        ">",
        "> Anh Hùng gửi báo giá",
        ">",
        "> cho khách \\*trước\\* thứ Sáu",
        "",
        "> **—** · Ghi chú",
        ">",
        "> Báo giá theo mẫu Q4",
      ].join("\n"),
    );
  });

  it("keeps whichever half there is, and says nothing when there is neither", () => {
    expect(actionItemTaskDescription("  Đặt phòng hội thảo.  ", [], t(), "vi-VN", "UTC")).toBe("Đặt phòng hội thảo.");
    expect(actionItemTaskDescription(null, [noted], t(), "vi-VN", "UTC")).toBe(
      ["**Căn cứ trong cuộc họp**", "", "> **—** · Ghi chú", ">", "> Báo giá theo mẫu Q4"].join("\n"),
    );
    expect(actionItemTaskDescription(" ", [], t(), "vi-VN", "UTC")).toBeUndefined();
  });
});

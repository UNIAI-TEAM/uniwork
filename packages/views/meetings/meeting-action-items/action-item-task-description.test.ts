import { describe, expect, it } from "vitest";
import { getI18n } from "react-i18next";
import { actionItemTaskDescription } from "./action-item-task-description";

const t = () => getI18n().t;
const said = { kind: "segment", id: "g1", author: "Minh Anh", text: "Anh Hùng gửi báo giá\ncho khách *trước* thứ Sáu", at: "2026-10-22T03:32:00Z" };
const noted = { kind: "note", id: "n1", author: null, text: "Báo giá theo mẫu Q4", at: null };

describe("actionItemTaskDescription", () => {
  it("puts the AI's prose first, then each cited line quoted with who, where and when", () => {
    const text = actionItemTaskDescription({ title: "Gửi báo giá", description: "Gửi báo giá cho khách trước thứ Sáu." }, [said, noted], t(), "vi-VN", "UTC");
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
    expect(actionItemTaskDescription({ title: "Đặt phòng", description: "  Đặt phòng hội thảo.  " }, [], t(), "vi-VN", "UTC")).toBe("Đặt phòng hội thảo.");
    expect(actionItemTaskDescription({ title: "Báo giá", description: null }, [noted], t(), "vi-VN", "UTC")).toBe(
      ["**Căn cứ trong cuộc họp**", "", "> **—** · Ghi chú", ">", "> Báo giá theo mẫu Q4"].join("\n"),
    );
    expect(actionItemTaskDescription({ title: "x", description: " " }, [], t(), "vi-VN", "UTC")).toBeUndefined();
  });

  it("quotes a line once, three lines at most, each cut short past 300 characters", () => {
    const long = { kind: "segment", id: "g2", author: "Minh Anh", text: "a".repeat(320), at: null };
    const text = actionItemTaskDescription({ title: "Gửi báo giá" }, [said, said, long, noted, { ...noted, id: "n2", text: "Một ghi chú khác" }], t(), "vi-VN", "UTC")!;
    // The same words said again (a looped or repeated line) are quoted once.
    expect(text.match(/Anh Hùng gửi báo giá/g)).toHaveLength(1);
    expect(text).toContain(`> ${"a".repeat(300)}…`);
    expect(text).not.toContain("a".repeat(301));
    // A fourth distinct line is left to the meeting's evidence chip.
    expect(text).toContain("Báo giá theo mẫu Q4");
    expect(text).not.toContain("Một ghi chú khác");
  });

  it("cuts a long line where it speaks of the task, and from its start when it never names it", () => {
    const monologue = `${"Mở đầu buổi họp và nhắc lại việc tuần trước. ".repeat(10)}Việc thứ ba: Minh cập nhật tài liệu hướng dẫn sử dụng sau buổi demo.`;
    const line = { kind: "segment", id: "g3", author: "Minh Anh", text: monologue, at: null };
    const text = actionItemTaskDescription({ title: "Cập nhật tài liệu hướng dẫn sử dụng" }, [line], t(), "vi-VN", "UTC")!;
    expect(text).toContain("cập nhật tài liệu hướng dẫn sử dụng sau buổi demo.");
    expect(text).toMatch(/> …\S/);
    const elsewhere = actionItemTaskDescription({ title: "Đặt vé máy bay" }, [line], t(), "vi-VN", "UTC")!;
    expect(elsewhere).toContain("> Mở đầu buổi họp");
  });

  it("quotes once two lines that read the same once cut to the task", () => {
    const tail = "Việc thứ ba: Minh cập nhật tài liệu hướng dẫn sử dụng sau buổi demo.";
    const a = { kind: "segment", id: "g4", author: "An", text: `${"Khách hàng ABC chờ báo giá. ".repeat(12)}${tail}`, at: null };
    const b = { ...a, id: "g5", text: `${"Khách hàng A Bơ C chờ báo giá. ".repeat(12)}${tail}` };
    const text = actionItemTaskDescription({ title: "Cập nhật tài liệu hướng dẫn sử dụng" }, [a, b], t(), "vi-VN", "UTC")!;
    expect(text.match(/sau buổi demo/g)).toHaveLength(1);
  });
});

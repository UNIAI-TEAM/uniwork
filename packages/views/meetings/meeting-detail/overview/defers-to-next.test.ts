import { describe, expect, it } from "vitest";
import { defersToNextMeeting, seriesShortTitle } from "./defers-to-next";

describe("defersToNextMeeting", () => {
  it("picks M1's two questions that wait for next week's meeting", () => {
    expect(
      defersToNextMeeting(
        "Có mời khoảng 10 phóng viên hay không, khi chi phí tăng thêm 40 triệu đồng và vượt ngân sách — chờ ban giám đốc quyết trong tuần sau.",
      ),
    ).toBe(true);
    expect(
      defersToNextMeeting(
        "Giá gói khởi đầu chọn mức nào: 299 nghìn, 349 nghìn hay 299 nghìn cho năm đầu rồi tăng — quyết ở buổi tuần sau cùng bảng chi phí hạ tầng.",
      ),
    ).toBe(true);
  });

  it("leaves the others alone", () => {
    expect(
      defersToNextMeeting(
        "Phương án dự phòng nếu kiểm thử tải phát hiện vấn đề lớn ở đồng bộ kho; Lan Phạm muốn xem số liệu kiểm thử giữa chừng trước khi quyết.",
      ),
    ).toBe(false);
    expect(defersToNextMeeting("Có mở thêm cụm máy chủ ở Thành phố Hồ Chí Minh sau ra mắt hay không.")).toBe(false);
  });

  it.each(["bàn ở buổi sau", "để lần họp tới", "chốt ở cuộc họp sau", "TUẦN  TỚI quyết", "quyet tuan sau"])("reads %s, accents and case aside", (text) => {
    expect(defersToNextMeeting(text)).toBe(true);
  });
});

describe("seriesShortTitle", () => {
  it("drops the suffix the series shares", () => {
    expect(seriesShortTitle("Giao ban tuần 44 — Ra mắt SaoMai POS 3.0", "Giao ban tuần 43 — Ra mắt SaoMai POS 3.0")).toBe("Giao ban tuần 44");
  });
  it("keeps a title that shares nothing, or is only the suffix", () => {
    expect(seriesShortTitle("Họp riêng", "Giao ban tuần 43 — Ra mắt")).toBe("Họp riêng");
    expect(seriesShortTitle("Giao ban — Q4", "Giao ban — Q3")).toBe("Giao ban — Q4");
    expect(seriesShortTitle("Giao ban tuần 44", "Giao ban tuần 43")).toBe("Giao ban tuần 44");
  });
});

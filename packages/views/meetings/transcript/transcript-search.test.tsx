import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightTranscript, transcriptLineMatches, transcriptMatches } from "./transcript-search";

describe("transcript search (UNI-1995 #14)", () => {
  it("marks every occurrence of every word, accent-insensitively, on the original letters", () => {
    expect(transcriptMatches("Ngân sách và ngan sach", "ngan sach")).toEqual([
      [0, 4],
      [5, 9],
      [13, 17],
      [18, 22],
    ]);
    expect(transcriptMatches("Anh Hùng", "hung")).toEqual([[4, 8]]);
    // Words apart and out of order are each marked.
    expect(transcriptMatches("Giá chốt, báo sau", "bao gia")).toEqual([
      [0, 3],
      [10, 13],
    ]);
  });

  it("folds đ/Đ and case both ways", () => {
    expect(transcriptMatches("Đề xuất đầu tư", "de dau")).toEqual([
      [0, 2],
      [8, 11],
    ]);
    expect(transcriptMatches("de xuat", "ĐỀ")).toEqual([[0, 2]]);
  });

  it("merges words that overlap into one mark", () => {
    expect(transcriptMatches("ngân sách", "an ngan")).toEqual([[0, 4]]);
    expect(transcriptMatches("báo báo", "bao bao")).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it("matches a line only when every word occurs", () => {
    expect(transcriptLineMatches("Giá chốt, báo sau", "bao gia")).toBe(true);
    expect(transcriptLineMatches("Báo cáo tuần", "bao gia")).toBe(false);
    expect(transcriptLineMatches("anything", "  ")).toBe(true);
    expect(transcriptMatches("anything", "  ")).toEqual([]);
  });

  it("marks each match and keeps the rest", () => {
    const { container } = render(<p>{highlightTranscript("Chốt ngân sách quý", "ngan")}</p>);
    expect(container.textContent).toBe("Chốt ngân sách quý");
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["ngân"]);
  });
});

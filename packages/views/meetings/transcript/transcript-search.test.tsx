import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightTranscript, transcriptMatches } from "./transcript-search";

describe("transcript search (UNI-1995 #14)", () => {
  it("finds every match, accent-insensitively, on the original letters", () => {
    expect(transcriptMatches("Ngân sách và ngan sach", "ngan sach")).toEqual([
      [0, 9],
      [13, 22],
    ]);
    expect(transcriptMatches("Anh Hùng", "hung")).toEqual([[4, 8]]);
    expect(transcriptMatches("anything", "  ")).toEqual([]);
  });

  it("marks each match and keeps the rest", () => {
    const { container } = render(<p>{highlightTranscript("Chốt ngân sách quý", "ngan")}</p>);
    expect(container.textContent).toBe("Chốt ngân sách quý");
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["ngân"]);
  });
});

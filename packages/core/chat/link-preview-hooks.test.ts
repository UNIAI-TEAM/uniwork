import { describe, expect, it } from "vitest";
import { linkPreviewCandidateIds } from "./link-preview-hooks";

describe("linkPreviewCandidateIds", () => {
  it("asks only for sent messages with a link in a text body", () => {
    expect(
      linkPreviewCandidateIds([
        { id: "03", body: "Bài blog: https://uniwork.vn/blog/ra-mat-q4" },
        { id: "01", body: "xem http://a.vn nhé" },
        { id: "02", body: "không có liên kết" },
        { id: "04", body: "![gif](https://media.tenor.com/x.gif)" },
        { id: "pending:c1", body: "https://uniwork.vn" },
        { id: "01", body: "xem http://a.vn nhé" },
      ]),
    ).toEqual(["01", "03"]);
  });

  it("keeps the newest batch of 200", () => {
    const messages = Array.from({ length: 205 }, (_, i) => ({
      id: String(i).padStart(3, "0"),
      body: `https://a.vn/${i}`,
    }));
    const ids = linkPreviewCandidateIds(messages);
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe("005");
    expect(ids.at(-1)).toBe("204");
  });
});

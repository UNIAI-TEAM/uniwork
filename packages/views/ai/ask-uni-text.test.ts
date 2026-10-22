import { describe, expect, it } from "vitest";
import type { AiCitation } from "@uniwork/core/types";
import { answerPlainText } from "./ask-uni-text";

const src = (id: string, title: string): AiCitation => ({ source_id: id, kind: "project", title, quote: "", href: "/a/b/projects/1" });
const map = new Map([["S3", src("S3", "Ra mắt Q4")]]);

describe("answerPlainText", () => {
  it("puts the object's name where the marker was", () => {
    expect(answerPlainText("Dự án [S3] có 2 việc", map)).toBe("Dự án Ra mắt Q4 có 2 việc");
  });
  it("drops an unknown marker without leaving two spaces", () => {
    expect(answerPlainText("Xong [S9] rồi. Tiếp [S1][S2].", map)).toBe("Xong rồi. Tiếp.");
  });
  it("keeps text without markers as is", () => {
    expect(answerPlainText("Không có nguồn.", map)).toBe("Không có nguồn.");
  });
});

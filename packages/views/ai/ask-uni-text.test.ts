import { describe, expect, it } from "vitest";
import type { AiCitation } from "@uniwork/core/types";
import { answerPlainText, foldText, matchRange } from "./ask-uni-text";

const src = (id: string, title: string): AiCitation => ({ source_id: id, kind: "project", title, quote: "", href: "/a/b/projects/1" });
const map = new Map([["S3", src("S3", "Ra mắt Q4")]]);
const two = new Map([["S1", src("S1", "Một")], ["S2", src("S2", "Hai")]]);

describe("answerPlainText", () => {
  it("puts the object's name where the marker was", () => {
    expect(answerPlainText("Dự án [S3] có 2 việc", map)).toBe("Dự án Ra mắt Q4 có 2 việc");
  });
  it("drops an unknown marker without leaving two spaces", () => {
    expect(answerPlainText("Xong [S9] rồi. Tiếp [S1][S2].", map)).toBe("Xong rồi. Tiếp.");
  });
  it.each([
    ["A [S1][S2]", "A Một, Hai"],
    ["A [S1] [S2].", "A Một, Hai."],
    ["A [S1][S9][S2].", "A Một, Hai."],
    ["A [S8][S9]!", "A!"],
  ])("joins an adjacent run of names: %s", (input, out) => expect(answerPlainText(input, two)).toBe(out));
  it("keeps text without markers as is", () => {
    expect(answerPlainText("Không có nguồn.", map)).toBe("Không có nguồn.");
  });
});

describe("foldText", () => {
  it("drops marks, folds đ and lowercases", () => {
    expect(foldText("Việc Trễ Đ")).toBe("viec tre d");
  });
});

describe("matchRange", () => {
  it("returns indices into the original title", () => {
    expect(matchRange("Hoàn thiện", "hoan")).toEqual([0, 4]);
    expect(matchRange("Nộp app", "xyz")).toBeNull();
    expect(matchRange("Nộp app", "")).toBeNull();
    expect(matchRange("Việc đỏ", "đo")).toEqual([5, 7]);
  });
  it("keeps indices right on decomposed input", () => {
    const nfd = "Hoàn thiện".normalize("NFD");
    const r = matchRange(nfd, "hoan");
    expect(r).not.toBeNull();
    expect(nfd.slice(r![0], r![1]).normalize("NFC")).toBe("Hoàn");
    // A query that is itself decomposed matches the precomposed title too.
    expect(matchRange("Hoàn thiện", "hoàn".normalize("NFD"))).toEqual([0, 4]);
  });
});

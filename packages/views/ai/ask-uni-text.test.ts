import { describe, expect, it } from "vitest";
import type { AiCitation } from "@uniwork/core/types";
import { answerPlainText, dropEchoedNames, foldText, matchRange, questionPlainText } from "./ask-uni-text";

const src = (id: string, title: string): AiCitation => ({ source_id: id, kind: "project", title, quote: "", href: "/a/b/projects/1" });
const map = new Map([["S3", src("S3", "Ra mắt Q4")]]);
const two = new Map([["S1", src("S1", "Một")], ["S2", src("S2", "Hai")]]);

describe("questionPlainText", () => {
  it("reads the composer's markdown as the line typed", () => {
    expect(questionPlainText("Công việc của **từng người** trong cuộc họp?")).toBe("Công việc của từng người trong cuộc họp?");
    expect(questionPlainText("> Việc của:\n- Kiều\n2. Miên")).toBe("Việc của: Kiều Miên");
    expect(questionPlainText("Giá \\*ưu đãi\\* 2\\_3 `x`\n```\nconst a\n```")).toBe("Giá *ưu đãi* 2_3 x const a");
  });
});

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

describe("dropEchoedNames", () => {
  const page = new Map([["S4", { ...src("S4", "Thiết kế trang chủ"), kind: "task" }]]);
  const site = new Map([["S1", src("S1", "Website mới")]]);
  it.each([
    ["the name after the marker, keeping the stop", page, "- [S4] Thiết kế trang chủ.", "- [S4]."],
    ["the name before it, in bold", site, "**Website mới** [S1] đang chậm", "[S1] đang chậm"],
    ["the name before it, after other words", site, "Dự án **Website mới** [S1] đang chậm", "Dự án [S1] đang chậm"],
    ["the name at a line start", site, "Website mới [S1]: 3 việc", "[S1]: 3 việc"],
    ["another case and a comma", page, "[S4] thiết kế trang chủ, rồi", "[S4], rồi"],
    ["a bold name after the marker", page, "[S4] **Thiết kế trang chủ** đang làm", "[S4] đang làm"],
    ["a dash after the name", page, "- [S4] Thiết kế trang chủ — Cần làm", "- [S4] — Cần làm"],
    ["the name with more words after it", page, "[S4] Thiết kế trang chủ đang chậm", "[S4] đang chậm"],
    ["the name inside a sentence before it", site, "Dự án Website mới [S1] đang", "Dự án [S1] đang"],
    ["the name after 'và'", page, "Hai việc: [S1] và Thiết kế trang chủ [S4] đều chậm", "Hai việc: [S1] và [S4] đều chậm"],
    ["the name in a table cell", page, "| Thiết kế trang chủ [S4] | todo |", "| [S4] | todo |"],
    ["the name before a bracket", page, "[S4] Thiết kế trang chủ (hạn 25/10)", "[S4] (hạn 25/10)"],
  ])("drops %s", (_n, byId, input, out) => expect(dropEchoedNames(input, byId)).toBe(out));
  const meeting = new Map([["S2", { ...src("S2", "Họp"), kind: "meeting" }]]);
  it.each([
    ["a partial name", page, "[S4] Thiết kế mới"],
    ["a name that runs on into a longer word", site, "[S1] Website mớiii"],
    ["a word that differs only in its tone mark", meeting, "[S2] hợp lý"],
    ["an unknown marker", page, "[S9] Thiết kế trang chủ."],
  ])("keeps %s", (_n, byId, input) => expect(dropEchoedNames(input, byId)).toBe(input));
  it("copies the name once", () => {
    expect(answerPlainText("- [S4] Thiết kế trang chủ.", page)).toBe("- Thiết kế trang chủ.");
    expect(answerPlainText("**Website mới** [S1] đang", site)).toBe("Website mới đang");
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

import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { attendedText, rollParts, rsvpOf, rsvpTallyText, showsHistoryLink } from "./rail-model";

const fixed = initI18n().getFixedT("vi");
const t = (key: string, options?: Record<string, unknown>) => fixed(key, options);

describe("rail model", () => {
  it("reads an invitation's answer, anything unknown as not answered", () => {
    expect(["ACCEPTED", "TENTATIVE", "DECLINED", "PENDING", undefined, "NEW"].map(rsvpOf)).toEqual([
      "yes",
      "maybe",
      "no",
      "wait",
      "wait",
      "wait",
    ]);
  });

  it("tallies the answers in the board's order, zeros left out", () => {
    expect(rsvpTallyText(["ACCEPTED", "PENDING"], t)).toBe("1 nhận lời · 1 chưa phản hồi");
    expect(rsvpTallyText(["ACCEPTED", "ACCEPTED", "ACCEPTED", "DECLINED"], t)).toBe("3 nhận lời · 1 từ chối");
    expect(rsvpTallyText(["PENDING", "TENTATIVE", "ACCEPTED"], t)).toBe("1 nhận lời · 1 chưa chắc · 1 chưa phản hồi");
    expect(rsvpTallyText([], t)).toBe("");
  });

  it("says the live roll and the ended one", () => {
    const live = { members: 5, present: 3, late: 1, excused: 1, absent: 0 };
    expect(rollParts(live, t)).toEqual(["3 có mặt", "1 muộn", "1 vắng có phép"]);
    expect(attendedText({ members: 3, present: 3, late: 0, excused: 0, absent: 0 }, t)).toBe("3/3 có mặt");
    expect(attendedText({ members: 4, present: 2, late: 1, excused: 0, absent: 1 }, t)).toBe("3/4 có mặt");
  });

  it("offers the history link to every reader but an outsider: the header has no ⋯ for it", () => {
    expect(showsHistoryLink("member")).toBe(true);
    expect(showsHistoryLink("host")).toBe(true);
    expect(showsHistoryLink("outsider")).toBe(false);
  });
});

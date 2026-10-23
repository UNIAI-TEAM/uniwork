import { describe, expect, it } from "vitest";
import type { MeetingMotion } from "../types/meeting";
import {
  canSubmitMotion,
  MOTION_DESCRIPTION_MAX_LENGTH,
  MOTION_TITLE_MAX_LENGTH,
  motionDenominator,
  motionsTabState,
  pendingBallot,
  requiredYes,
  tallyPercent,
  withMyBallots,
} from "./motion-utils";

const motion = (over: Partial<MeetingMotion> = {}): MeetingMotion => ({
  id: "mo1",
  title: "Thông qua kế hoạch quý IV",
  description: "",
  position: 1,
  ballot_mode: "PUBLIC",
  threshold: "MAJORITY",
  base: "PRESENT",
  status: "DRAFT",
  roll_size: null,
  total_members: null,
  cast_count: 0,
  result: null,
  voters: null,
  my_ballot: { on_roll: false, cast: false, choice: null },
  ...over,
});

describe("requiredYes — same table as the server's TestRequiredYes (Task 3)", () => {
  it.each([
    ["MAJORITY", 10, 6],
    ["MAJORITY", 15, 8],
    ["MAJORITY", 1, 1],
    ["MAJORITY", 0, 0],
    ["MAJORITY", -1, 0],
    ["TWO_THIRDS", 15, 10],
    ["TWO_THIRDS", 10, 7],
    ["TWO_THIRDS", 3, 2],
    ["TWO_THIRDS", 0, 0],
  ] as const)("%s of %i needs %i in favour", (threshold, denominator, want) => {
    expect(requiredYes(threshold, denominator)).toBe(want);
  });

  // Mirrors TestRequiredYesAgreesWithOutcome: "needs n" and the recorded outcome never disagree.
  it("agrees with motionOutcome's rule for every count up to 30", () => {
    for (let d = 0; d <= 30; d++) {
      for (let yes = 0; yes <= d; yes++) {
        const majority = d > 0 && yes * 2 > d;
        const twoThirds = d > 0 && yes * 3 >= d * 2;
        expect(d > 0 && yes >= requiredYes("MAJORITY", d)).toBe(majority);
        expect(d > 0 && yes >= requiredYes("TWO_THIRDS", d)).toBe(twoThirds);
      }
    }
  });
});

describe("motionDenominator", () => {
  it("counts the roll for PRESENT and every member for ALL_MEMBERS", () => {
    expect(motionDenominator("PRESENT", 7, 12)).toBe(7);
    expect(motionDenominator("ALL_MEMBERS", 7, 12)).toBe(12);
  });
});

describe("canSubmitMotion — the server's limits, counted in runes after trimming", () => {
  it("needs a title", () => {
    expect(canSubmitMotion("", "")).toBe(false);
    expect(canSubmitMotion("   ", "")).toBe(false);
    expect(canSubmitMotion(" Bầu thư ký ", "")).toBe(true);
  });

  it("takes exactly 200 accented characters and refuses 201", () => {
    expect(MOTION_TITLE_MAX_LENGTH).toBe(200);
    expect(canSubmitMotion("ệ".repeat(200), "")).toBe(true);
    expect(canSubmitMotion("ệ".repeat(201), "")).toBe(false);
  });

  it("counts an emoji as one character, like Go", () => {
    expect(canSubmitMotion("😀".repeat(200), "")).toBe(true);
  });

  it("caps the description at 2000", () => {
    expect(MOTION_DESCRIPTION_MAX_LENGTH).toBe(2000);
    expect(canSubmitMotion("Bầu thư ký", "ử".repeat(2000))).toBe(true);
    expect(canSubmitMotion("Bầu thư ký", "ử".repeat(2001))).toBe(false);
  });
});

describe("pendingBallot", () => {
  it("is the open item I am on the roll for and have not voted on", () => {
    const open = motion({ id: "mo2", status: "OPEN", my_ballot: { on_roll: true, cast: false, choice: null } });
    expect(pendingBallot([motion(), open, motion({ id: "mo3", status: "CLOSED" })])).toBe(open);
  });

  it("is null once cast, off the roll, without a ballot, or with nothing open", () => {
    expect(pendingBallot(undefined)).toBeNull();
    expect(pendingBallot([])).toBeNull();
    expect(pendingBallot([motion({ status: "OPEN", my_ballot: { on_roll: true, cast: true, choice: null } })])).toBeNull();
    expect(pendingBallot([motion({ status: "OPEN", my_ballot: { on_roll: false, cast: false, choice: null } })])).toBeNull();
    expect(pendingBallot([motion({ status: "OPEN", my_ballot: undefined })])).toBeNull();
    expect(pendingBallot([motion({ status: "CLOSED", my_ballot: { on_roll: true, cast: false, choice: null } })])).toBeNull();
  });
});

describe("motionsTabState", () => {
  it("always shows the tab to a clerk, even with drafts only", () => {
    expect(motionsTabState([], true)).toEqual({ visible: true, pending: false });
    expect(motionsTabState([motion()], true)).toEqual({ visible: true, pending: false });
  });

  it("shows it to everyone else once something left draft", () => {
    expect(motionsTabState(undefined, false)).toEqual({ visible: false, pending: false });
    expect(motionsTabState([motion()], false)).toEqual({ visible: false, pending: false });
    expect(motionsTabState([motion({ status: "CLOSED" })], false)).toEqual({ visible: true, pending: false });
  });

  it("flags a ballot waiting for me", () => {
    const open = motion({ status: "OPEN", my_ballot: { on_roll: true, cast: false, choice: null } });
    expect(motionsTabState([open], false)).toEqual({ visible: true, pending: true });
  });
});

describe("tallyPercent", () => {
  it("is 0 with nothing to divide by", () => {
    expect(tallyPercent(0, 0)).toBe(0);
    expect(tallyPercent(3, 0)).toBe(0);
    expect(tallyPercent(0, 5)).toBe(0);
  });

  it("rounds to a whole percent", () => {
    expect(tallyPercent(1, 3)).toBe(33);
    expect(tallyPercent(2, 3)).toBe(67);
    expect(tallyPercent(5, 5)).toBe(100);
  });

  it("never shows a cast vote as 0% or a split as 100%", () => {
    expect(tallyPercent(1, 1000)).toBe(1);
    expect(tallyPercent(999, 1000)).toBe(99);
  });
});

describe("withMyBallots — the list is the same for everyone; the caller's roll joins it here", () => {
  const open = motion({ id: "mo1", status: "OPEN", my_ballot: undefined });
  const closed = motion({ id: "mo2", status: "CLOSED", my_ballot: undefined });

  it("puts each motion on or off the caller's roll", () => {
    const got = withMyBallots([open, closed], [{ motion_id: "mo2", cast: true, choice: "NO" }]);
    expect(got.map((m) => m.my_ballot)).toEqual([
      { on_roll: false, cast: false, choice: null },
      { on_roll: true, cast: true, choice: "NO" },
    ]);
    expect(pendingBallot(got)).toBeNull();
  });

  it("an uncast line on the open motion is the pending ballot", () => {
    const got = withMyBallots([open], [{ motion_id: "mo1", cast: false }]);
    expect(pendingBallot(got)?.id).toBe("mo1");
  });

  it("leaves the list untouched until the roll is known", () => {
    const list = [open, closed];
    expect(withMyBallots(list, undefined)).toBe(list);
    expect(withMyBallots(list, null)).toBe(list);
  });
});

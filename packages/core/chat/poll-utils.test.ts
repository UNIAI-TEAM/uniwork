import { describe, expect, it } from "vitest";
import {
  canSubmitPoll,
  canViewPollVoters,
  DEFAULT_ROOM_POLL_SETTINGS,
  groupPollVotersByOption,
  isPollExpired,
  mergePollSettings,
  normalizePollOptions,
  POLL_QUESTION_MAX_LENGTH,
} from "./poll-utils";

describe("poll-utils", () => {
  it("merges partial poll settings with defaults", () => {
    expect(mergePollSettings({ pinToTop: true })).toEqual({
      ...DEFAULT_ROOM_POLL_SETTINGS,
      pinToTop: true,
    });
  });

  it("validates poll submission", () => {
    expect(canSubmitPoll("", ["A", "B"])).toBe(false);
    expect(canSubmitPoll("Question?", ["A"])).toBe(false);
    expect(canSubmitPoll("Question?", ["A", "B"])).toBe(true);
    expect(canSubmitPoll("x".repeat(POLL_QUESTION_MAX_LENGTH + 1), ["A", "B"])).toBe(false);
  });

  it("normalizes poll options", () => {
    expect(normalizePollOptions(["  A  ", "", "B"])).toEqual(["A", "B"]);
  });

  it("detects expired polls", () => {
    expect(isPollExpired(null)).toBe(false);
    expect(isPollExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(isPollExpired(new Date(Date.now() - 60_000).toISOString())).toBe(true);
  });

  it("groups voters by option", () => {
    expect(
      groupPollVotersByOption(
        { USER1: ["opt-a"], USER2: ["opt-a", "opt-b"] },
        ["opt-a", "opt-b", "opt-c"],
      ),
    ).toEqual({
      "opt-a": ["USER1", "USER2"],
      "opt-b": ["USER2"],
      "opt-c": [],
    });
  });

  it("hides voters when poll settings require it", () => {
    expect(
      canViewPollVoters({
        settings: { hide_voters: true, hide_results_until_vote: false },
        votes_by_user: { USER1: ["opt-a"] },
      }),
    ).toBe(false);
    expect(
      canViewPollVoters({
        settings: { hide_voters: false, hide_results_until_vote: true },
        viewer_option_ids: [],
        votes_by_user: { USER1: ["opt-a"] },
      }),
    ).toBe(false);
    expect(
      canViewPollVoters({
        settings: { hide_voters: false, hide_results_until_vote: true },
        viewer_option_ids: ["opt-a"],
        votes_by_user: { USER1: ["opt-a"] },
      }),
    ).toBe(true);
  });
});

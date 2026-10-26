import { describe, expect, it } from "vitest";
import { capJobs, nextStepJobs, type StripInput, type StripItem } from "./next-step-jobs";

const base: StripInput = {
  status: "SCHEDULED",
  viewer: "host",
  canHost: true,
  canCancel: true,
  isClerk: true,
  hasInvitation: false,
  pendingNames: ["Minh Trần"],
  liveNeed: 0,
  windowAhead: true,
  items: null,
  userId: "u-minh",
  minutes: "off",
  minutesEditable: false,
};

const item = (over: Partial<StripItem>): StripItem => ({ title: "Việc", status: "PENDING", ...over });

describe("nextStepJobs", () => {
  it("gives the runner the start row before the meeting, and an invitee the RSVP row", () => {
    expect(nextStepJobs(base)).toEqual([{ kind: "start", canStart: true, pendingNames: ["Minh Trần"] }]);
    expect(nextStepJobs({ ...base, viewer: "member", canHost: false, hasInvitation: true })).toEqual([{ kind: "rsvp" }]);
    // Not invited, not running it: the start row, joining instead of starting.
    expect(nextStepJobs({ ...base, viewer: "member", canHost: false })[0]).toMatchObject({ kind: "start", canStart: false });
  });

  it("lets only the runner end, extend, restore or reschedule", () => {
    expect(nextStepJobs({ ...base, status: "IN_PROGRESS", liveNeed: 2 })).toEqual([{ kind: "live", need: 2, canEnd: true }]);
    expect(nextStepJobs({ ...base, status: "IN_PROGRESS", canHost: false, viewer: "member" })[0]).toMatchObject({ canEnd: false });
    expect(nextStepJobs({ ...base, status: "OVERTIME", canHost: false, viewer: "member" })).toEqual([{ kind: "overtime", canAct: false }]);
    expect(nextStepJobs({ ...base, status: "MISSED" })).toEqual([{ kind: "missed", canAct: true }]);
    expect(nextStepJobs({ ...base, status: "CANCELED", windowAhead: false })).toEqual([{ kind: "canceled", canRestore: false }]);
    expect(nextStepJobs({ ...base, status: "CANCELED", canCancel: false })).toEqual([{ kind: "canceled", canRestore: false }]);
    expect(nextStepJobs({ ...base, status: "CANCELED" })).toEqual([{ kind: "canceled", canRestore: true }]);
  });

  it("gives an outsider the lock line once the meeting has started, and nothing to do", () => {
    expect(nextStepJobs({ ...base, status: "ENDED", viewer: "outsider", isClerk: false, canHost: false })).toEqual([{ kind: "outsider" }]);
    expect(nextStepJobs({ ...base, status: "IN_PROGRESS", viewer: "outsider" })).toEqual([{ kind: "outsider" }]);
  });

  it("counts the clerk's close-out: pending, guessed dues, the earliest due and the minutes", () => {
    const items = [
      item({ suggested_due_date: "2026-10-27" }),
      item({ suggested_due_date: "2026-10-26", suggested_due_guessed: true }),
      item({ suggested_due_guessed: true }),
      item({ status: "CONVERTED" }),
      item({ status: "DISMISSED" }),
    ];
    const [job] = nextStepJobs({ ...base, status: "ENDED", items, minutes: "draft", minutesEditable: true });
    expect(job).toEqual({
      kind: "closeOut",
      pending: 3,
      converted: 1,
      guessed: 1,
      earliestDue: "2026-10-26",
      noItems: false,
      drafting: false,
      minutes: "draft",
      canFinalize: true,
      canFollowUp: true,
    });
  });

  it("drops the close-out row when there is nothing to say or press", () => {
    expect(nextStepJobs({ ...base, status: "ENDED", canHost: false, viewer: "secretary", items: [], minutes: "final" })).toEqual([]);
    expect(nextStepJobs({ ...base, status: "ENDED", items: [], minutes: "final" })[0]).toMatchObject({ canFollowUp: true });
  });

  it("says there are no items only once they have loaded (AfterAIStates c4)", () => {
    const ended = { ...base, status: "ENDED" as const, minutes: "draft" as const };
    expect(nextStepJobs({ ...ended, items: [item({ status: "DISMISSED" })] })[0]).toMatchObject({ noItems: true });
    expect(nextStepJobs({ ...ended, items: null })[0]).toMatchObject({ noItems: false });
  });

  it("says the summary is being written while the run is under way and nothing has come yet (AfterAIStates c1)", () => {
    const ended = { ...base, status: "ENDED" as const, minutes: "none" as const, items: [], summaryRunning: true };
    expect(nextStepJobs(ended)[0]).toMatchObject({ kind: "closeOut", drafting: true, canFinalize: false });
    expect(nextStepJobs({ ...ended, items: [item({})] })[0]).toMatchObject({ drafting: false, pending: 1 });
  });

  it("tells a member their own items: assigned, waiting and the nearest due", () => {
    const items = [
      item({ title: "A", status: "CONVERTED", task: { assignee_id: "u-minh", due_date: "2026-11-05" } }),
      item({ title: "B", suggested_assignee_id: "u-minh", suggested_due_date: "2026-10-26" }),
      item({ title: "C", suggested_assignee_id: "u-ha" }),
    ];
    const member = { ...base, status: "ENDED", viewer: "member" as const, isClerk: false, canHost: false, items };
    expect(nextStepJobs(member)).toEqual([
      { kind: "memberItems", mine: 2, assigned: 1, waiting: 1, nearest: { title: "B", due: "2026-10-26" } },
    ]);
    expect(nextStepJobs({ ...member, userId: "u-bao" })).toEqual([]);
  });

  it("caps the strip at three rows and counts the rest", () => {
    const jobs = Array.from({ length: 5 }, () => ({ kind: "outsider" as const }));
    expect(capJobs(jobs)).toEqual({ shown: jobs.slice(0, 3), more: 2 });
    expect(capJobs([])).toEqual({ shown: [], more: 0 });
  });
});

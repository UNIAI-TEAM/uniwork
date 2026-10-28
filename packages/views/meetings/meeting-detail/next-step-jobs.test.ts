import { describe, expect, it } from "vitest";
import { capJobs, nextStepJobs, transcribingOf, type StripInput, type StripItem } from "./next-step-jobs";

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
    expect(nextStepJobs(base)).toEqual([{ kind: "start", canStart: true, pendingNames: ["Minh Trần"], inPerson: false, canRecord: false }]);
    expect(nextStepJobs({ ...base, viewer: "member", canHost: false, hasInvitation: true })).toEqual([{ kind: "rsvp" }]);
    // Not invited, not running it: the start row, joining instead of starting.
    expect(nextStepJobs({ ...base, viewer: "member", canHost: false })[0]).toMatchObject({ kind: "start", canStart: false });
  });

  it("an in-person start job lets a clerk record", () => {
    expect(nextStepJobs({ ...base, inPerson: true, isClerk: true, canRecord: true })[0]).toMatchObject({
      kind: "start",
      inPerson: true,
      canRecord: true,
    });
  });

  it("lets an invited secretary record an in-person meeting instead of answering", () => {
    const secretary = { ...base, viewer: "secretary" as const, canHost: false, isClerk: true, hasInvitation: true };
    expect(nextStepJobs({ ...secretary, inPerson: true, canRecord: true })[0]).toMatchObject({
      kind: "start",
      inPerson: true,
      canRecord: true,
    });
    // Online, or with no recording to offer, the invitation is still answered.
    expect(nextStepJobs(secretary)).toEqual([{ kind: "rsvp" }]);
    expect(nextStepJobs({ ...secretary, inPerson: true, canRecord: false })).toEqual([{ kind: "rsvp" }]);
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

  describe("in person, once the recording was sent (UNI-2247)", () => {
    const ended = { ...base, status: "ENDED" as const, inPerson: true, items: [], minutes: "none" as const };
    const part = (status: string, estimated_seconds?: number) => ({ status, estimated_seconds });

    it("an in-person meeting being transcribed", () => {
      const transcribing = transcribingOf([part("RUNNING", 2538)]);
      expect(nextStepJobs({ ...ended, transcribing })).toEqual([{ kind: "transcribing", minutes: 42, etaMinutes: 4 }]);
      // Anyone at the meeting reads it, not only the clerk.
      expect(nextStepJobs({ ...ended, transcribing, viewer: "member", isClerk: false, canHost: false })[0]).toMatchObject({ kind: "transcribing" });
    });

    it("sizes a recording sent in parts from all of them, and the wait from the open ones", () => {
      const parts = [part("RUNNING", 1038), part("COMPLETE", 1500), part("FAILED", 900)];
      expect(transcribingOf(parts)).toEqual({ seconds: 2538, openSeconds: 1038 });
      expect(nextStepJobs({ ...ended, transcribing: transcribingOf(parts) })).toEqual([{ kind: "transcribing", minutes: 42, etaMinutes: 2 }]);
      // An earlier part still queued keeps the meeting transcribing after the newest one is done.
      expect(transcribingOf([part("COMPLETE", 600), part("QUEUED", 60)])).toEqual({ seconds: 660, openSeconds: 60 });
      expect(nextStepJobs({ ...ended, transcribing: transcribingOf([part("QUEUED", 60)]) })[0]).toMatchObject({ etaMinutes: 1 });
      // Nothing open: no transcribing row.
      expect(transcribingOf([part("COMPLETE", 600), part("FAILED", 60)])).toBeNull();
      expect(transcribingOf(undefined)).toBeNull();
    });

    it("close-out names unnamed speakers first", () => {
      const [job] = nextStepJobs({ ...ended, items: [item({})], minutes: "draft", minutesEditable: true, unnamedSpeakers: 3 });
      expect(job).toMatchObject({ kind: "closeOut", unnamedSpeakers: 3, pending: 1 });
      // Unnamed speakers alone still make a row.
      expect(nextStepJobs({ ...ended, canHost: false, viewer: "secretary", minutes: "final", unnamedSpeakers: 1 })[0]).toMatchObject({
        unnamedSpeakers: 1,
      });
    });

    it("leaves an online meeting's close-out as it was", () => {
      const online = { ...ended, inPerson: false, transcribing: transcribingOf([part("RUNNING", 600)]) };
      expect(nextStepJobs(online)[0]).toMatchObject({ kind: "closeOut" });
    });
  });

  describe("a recording left on this device (UNI-2247)", () => {
    const unsent = { seconds: 2112, savedAt: 1_000 };

    it("comes first, and before the start it is the only row", () => {
      expect(nextStepJobs({ ...base, inPerson: true, canRecord: true, unsent })).toEqual([
        { kind: "unsent", seconds: 2112, savedAt: 1_000, canContinue: true, canSend: true },
      ]);
      expect(nextStepJobs({ ...base, viewer: "member", canHost: false, hasInvitation: true, unsent })).toEqual([
        expect.objectContaining({ kind: "unsent" }),
      ]);
      const ended = nextStepJobs({ ...base, status: "ENDED", inPerson: true, minutes: "none", unsent });
      expect(ended.map((j) => j.kind)).toEqual(["unsent", "closeOut"]);
    });

    it("continues only while the meeting is open, and sends unless it was called off", () => {
      const of = (status: StripInput["status"]) => nextStepJobs({ ...base, status, inPerson: true, unsent })[0];
      expect(of("MISSED")).toMatchObject({ kind: "unsent", canContinue: true, canSend: true });
      expect(of("ENDED")).toMatchObject({ kind: "unsent", canContinue: false, canSend: true });
      expect(of("CANCELED")).toMatchObject({ kind: "unsent", canContinue: false, canSend: false });
    });

    it("draws nothing without one", () => {
      expect(nextStepJobs({ ...base, unsent: null })[0]).toMatchObject({ kind: "start" });
    });

    it("past its planned end, an in-person meeting being recorded is not missed", () => {
      // It stays SCHEDULED until it is recorded held, so the clock turns it MISSED mid-recording.
      expect(nextStepJobs({ ...base, status: "MISSED", inPerson: true, canRecord: true, unsent })).toEqual([
        { kind: "unsent", seconds: 2112, savedAt: 1_000, canContinue: true, canSend: true },
      ]);
    });
  });

  it("a clerk who starts an in-person meeting late may still record it", () => {
    const secretary = { ...base, status: "MISSED" as const, viewer: "secretary" as const, canHost: false, inPerson: true };
    expect(nextStepJobs({ ...secretary, canRecord: true })).toEqual([
      { kind: "start", canStart: false, pendingNames: ["Minh Trần"], inPerson: true, canRecord: true },
    ]);
    // Nobody here can record: it reads as missed, as an online meeting does.
    expect(nextStepJobs({ ...secretary, canRecord: false })[0]).toMatchObject({ kind: "missed" });
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

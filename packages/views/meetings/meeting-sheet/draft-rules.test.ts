import { describe, expect, it } from "vitest";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types/meeting";
import { draftChanges, emptyDraft, isDirty, newGuestLink, newMotion, setRole, type MeetingDraft } from "./draft-model";
import { durationMinutes, nextQuarterHour, parseQuorum, plusMinutes, validateDraft } from "./draft-validation";
import { followUpDraft, followUpTitle, followUpWindow, isoWeek } from "./follow-up-draft";

const NOW = Date.parse("2026-10-23T14:18:00Z"); // Fri 23/10 21:18 ICT
const HCM = "Asia/Ho_Chi_Minh";

function draft(over: Partial<MeetingDraft> = {}): MeetingDraft {
  return { ...emptyDraft(NOW, HCM), ...over };
}

describe("draft model", () => {
  it("defaults to the next full hour for 30 minutes", () => {
    expect(emptyDraft(NOW, HCM)).toMatchObject({ date: "2026-10-23", start: "22:00", end: "22:30", allowJoin: true, scribe: null });
  });

  it("is clean after a change is reverted, and counts each change", () => {
    const snap = draft();
    expect(isDirty(draft({ title: "  " }), snap)).toBe(false);
    const changed = draft({ title: "A", people: [{ userId: "u1", role: "MEMBER" }], links: [newGuestLink()] });
    expect(draftChanges(changed, snap)).toHaveLength(3);
  });

  it("counts a role change, a removal and a moved motion", () => {
    const m1 = { ...newMotion(), id: "x1", title: "A", position: 1 };
    const m2 = { ...newMotion(), id: "x2", title: "B", position: 2 };
    const snap = draft({ people: [{ userId: "u1", role: "MEMBER" }, { userId: "u2", role: "MEMBER" }], motions: [m1, m2] });
    const next = draft({ people: [{ userId: "u1", role: "SECRETARY" }], motions: [m2, m1] });
    expect(draftChanges(next, snap).sort()).toEqual(["motion-order", "person-:u2", "role:u1"]);
  });

  it("moves the secretary role off anyone else", () => {
    const people = setRole([{ userId: "a", role: "SECRETARY" }, { userId: "b", role: "MEMBER" }], "b", "SECRETARY");
    expect(people.map((p) => p.role)).toEqual(["MEMBER", "SECRETARY"]);
  });
});

describe("draft validation", () => {
  it("lists issues in visual order and only checks the past when asked", () => {
    const d = draft({ title: "", start: "21:00", end: "21:30" });
    expect(validateDraft(d, { nowMs: NOW, checkPast: true }).map((i) => i.code)).toEqual(["titleRequired", "startPassed"]);
    expect(validateDraft(d, { nowMs: NOW, checkPast: false }).map((i) => i.code)).toEqual(["titleRequired"]);
    expect(validateDraft(draft({ title: "x", start: "22:00", end: "22:00" }), { nowMs: NOW, checkPast: true })[0]?.code).toBe("endSame");
  });

  it("asks a self-admitting link for a limit and checks motions and quorum", () => {
    const link = { ...newGuestLink(), access: "AUTO_ADMIT" as const };
    const motion = { ...newMotion(), title: "x".repeat(201) };
    const issues = validateDraft(draft({ title: "x", links: [link], motions: [motion], quorum: "120" }), { nowMs: NOW, checkPast: true });
    expect(issues.map((i) => i.code)).toEqual(["linkLimit", "motionTooLong", "quorumInvalid"]);
    expect(issues.every((i) => i.section === "more")).toBe(true);
  });

  it("parses quorum and times", () => {
    expect(parseQuorum("")).toEqual({ value: 0, invalid: false });
    expect(parseQuorum("60").invalid).toBe(false);
    expect(parseQuorum("0").invalid).toBe(true);
    expect(parseQuorum("6.5").invalid).toBe(true);
    expect(durationMinutes("22:00", "01:00")).toBe(180);
    expect(plusMinutes("23:45", 30)).toBe("00:15");
    expect(new Date(nextQuarterHour(NOW)).toISOString()).toBe("2026-10-23T14:30:00.000Z");
  });
});

describe("follow-up draft", () => {
  const m1 = {
    id: "m1",
    title: "Giao ban tuần 43 — Ra mắt SaoMai POS 3.0",
    description: "Họp giao ban hằng tuần",
    starts_at: "2026-10-22T02:00:00Z",
    ends_at: "2026-10-22T02:28:00Z",
    timezone: HCM,
    host_user_id: "lan",
    project_id: "p1",
    allow_join_request: true,
    scribe_enabled: true,
    ai_content_shared: false,
  } as Meeting;
  const people = [
    { id: "p-lan", user_id: "lan", status: "ACTIVE", is_secretary: false },
    { id: "p-ha", user_id: "ha", status: "ACTIVE", is_secretary: true },
    { id: "p-x", user_id: "x", status: "REMOVED" },
  ] as MeetingParticipant[];

  it("takes the next week's slot with the length rounded up to 15 minutes", () => {
    expect(followUpWindow(m1, NOW, HCM)).toEqual({ date: "2026-10-29", start: "09:00", end: "09:30" });
  });

  it("swaps the week number only when it is the previous meeting's week", () => {
    expect(isoWeek("2026-10-22")).toBe(43);
    expect(followUpTitle(m1.title, "2026-10-22", "2026-10-29")).toEqual({
      title: "Giao ban tuần 44 — Ra mắt SaoMai POS 3.0",
      swap: { from: 43, to: 44 },
    });
    expect(followUpTitle("Giao ban tuần 12", "2026-10-22", "2026-10-29").swap).toBeNull();
  });

  it("leaves the agenda empty, roles unapplied and copies the settings", () => {
    const { draft: d } = followUpDraft(m1, people, NOW, HCM);
    expect(d).toMatchObject({ description: "", projectId: "p1", scribe: true, aiShared: false, people: [{ userId: "ha", role: "MEMBER" }] });
  });
});

import { describe, expect, it } from "vitest";
import { sectionFlags, viewerRole, visibleTabs } from "./detail-model";

const p = (user_id: string, extra: { status?: string; is_secretary?: boolean } = {}) => ({
  user_id,
  principal_type: "USER",
  status: extra.status ?? "ACTIVE",
  is_secretary: extra.is_secretary,
});
const participants = [p("lan"), p("ha", { is_secretary: true }), p("minh"), p("gone", { status: "REMOVED" })];

describe("viewerRole", () => {
  it("tells host, secretary, admin, member and outsider apart", () => {
    const role = (userId: string, canHost = false) => viewerRole({ userId, hostUserId: "lan", participants, canHost });
    expect(role("lan", true)).toBe("host");
    expect(role("ha")).toBe("secretary");
    expect(role("boss", true)).toBe("admin");
    expect(role("minh")).toBe("member");
    expect(role("tuan")).toBe("outsider");
    expect(role("gone")).toBe("outsider");
  });

  it("never matches an empty user id to a missing host", () => {
    expect(viewerRole({ userId: "", hostUserId: "", participants: [], canHost: false })).toBe("outsider");
  });
});

describe("visibleTabs", () => {
  const all = { aiReadable: true, minutes: true };
  it("gives the ended and live tab sets", () => {
    expect(visibleTabs("ENDED", "host", all)).toEqual(["overview", "transcript", "minutes"]);
    expect(visibleTabs("ENDED", "member", { aiReadable: true, minutes: false })).toEqual(["overview", "transcript"]);
    expect(visibleTabs("IN_PROGRESS", "secretary", all)).toEqual(["notes", "transcript"]);
    expect(visibleTabs("OVERTIME", "member", { aiReadable: false, minutes: true })).toEqual(["notes"]);
  });

  it("has no tabs before, after a miss or a cancel, or for an outsider", () => {
    for (const status of ["SCHEDULED", "MISSED", "CANCELED"]) expect(visibleTabs(status, "host", all)).toEqual([]);
    expect(visibleTabs("ENDED", "outsider", all)).toEqual([]);
  });
});

describe("sectionFlags", () => {
  const base = { aiReadable: true, minutesOn: true, hasProject: true };
  it("keeps AI and notes from an outsider", () => {
    const f = sectionFlags({ ...base, status: "ENDED", viewer: "outsider" });
    expect(f).toMatchObject({ ai: false, notes: false, notesInput: false, actionItems: true, minutes: true });
  });

  it("drops the composer on a missed or canceled meeting only, and keeps it after the end", () => {
    expect(sectionFlags({ ...base, status: "MISSED", viewer: "host" }).notesInput).toBe(false);
    expect(sectionFlags({ ...base, status: "CANCELED", viewer: "host" }).notesInput).toBe(false);
    expect(sectionFlags({ ...base, status: "ENDED", viewer: "member" }).notesInput).toBe(true);
    expect(sectionFlags({ ...base, status: "SCHEDULED", viewer: "member" }).notesInput).toBe(true);
  });

  it("opens guest links and the lobby to the host and admins only, while they matter", () => {
    expect(sectionFlags({ ...base, status: "SCHEDULED", viewer: "host" })).toMatchObject({ guestLinks: true, lobby: false });
    expect(sectionFlags({ ...base, status: "OVERTIME", viewer: "admin" })).toMatchObject({ guestLinks: true, lobby: true });
    expect(sectionFlags({ ...base, status: "IN_PROGRESS", viewer: "secretary" })).toMatchObject({ guestLinks: false, lobby: false });
    expect(sectionFlags({ ...base, status: "ENDED", viewer: "host" })).toMatchObject({ guestLinks: false, lobby: false });
  });

  it("carries work over only before or during a meeting with a project", () => {
    expect(sectionFlags({ ...base, status: "SCHEDULED", viewer: "member" }).carriedOver).toBe(true);
    expect(sectionFlags({ ...base, hasProject: false, status: "SCHEDULED", viewer: "member" }).carriedOver).toBe(false);
    expect(sectionFlags({ ...base, status: "ENDED", viewer: "member" }).carriedOver).toBe(false);
    expect(sectionFlags({ ...base, status: "ENDED", viewer: "member", minutesOn: false }).minutes).toBe(false);
  });
});

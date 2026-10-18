import { describe, expect, it } from "vitest";
import { callLogSections, callLogTitle, callLogView, formatCallClock, formatCallTime, formatVoiceCallDuration } from "./call-log-display";
import { i18n } from "./i18n/singleton";

const call = (outcome: string, caller: string, extra: { video?: boolean; duration_seconds?: number } = {}) => ({
  outcome,
  caller_id: caller,
  video: extra.video ?? false,
  duration_seconds: extra.duration_seconds ?? 125,
});

const label = (view: ReturnType<typeof callLogView>) => i18n.getFixedT("vi")(view.labelKey, view.labelParams);

// The same cases as packages/views/chat/voice-call-log-row.test.tsx, read through the mobile bundle.
describe("callLogView (parity with the web call-log row)", () => {
  it("labels a completed call with its duration, voice or video", () => {
    expect(label(callLogView(call("completed", "peer"), "me"))).toBe("Cuộc gọi · 2:05");
    expect(label(callLogView(call("completed", "peer", { video: true }), "me"))).toBe("Cuộc gọi video · 2:05");
  });

  it("an unanswered call is missed for the callee and cancelled for the caller; only missed is flagged", () => {
    const missed = callLogView(call("unanswered", "peer"), "me");
    expect(label(missed)).toBe("Cuộc gọi nhỡ");
    expect(missed).toMatchObject({ missed: true, direction: "incoming" });
    const cancelled = callLogView(call("unanswered", "me"), "me");
    expect(label(cancelled)).toBe("Đã hủy cuộc gọi");
    expect(cancelled).toMatchObject({ missed: false, direction: "outgoing" });
  });

  it("a declined call reads from the side of whoever looks at it", () => {
    expect(label(callLogView(call("declined", "me"), "me"))).toBe("Cuộc gọi bị từ chối");
    expect(label(callLogView(call("declined", "peer", { video: true }), "me"))).toBe("Bạn đã từ chối cuộc gọi video");
  });

  it("an outcome it does not know still says a call happened", () => {
    expect(label(callLogView(call("", "peer"), "me"))).toBe("Cuộc gọi");
    expect(callLogView(call("", "peer"), "me").missed).toBe(false);
  });
});

describe("formatVoiceCallDuration (copy of packages/views/chat/voice-call-duration.ts)", () => {
  it("formats M:SS under an hour and H:MM:SS above, never negative", () => {
    expect(formatVoiceCallDuration(125)).toBe("2:05");
    expect(formatVoiceCallDuration(3_725)).toBe("1:02:05");
    expect(formatVoiceCallDuration(-3)).toBe("0:00");
  });
});

describe("callLogTitle", () => {
  const log = { room_kind: "dm", room_name: "Chat B", peer_user_id: "01ABC", caller_name: "Chat A" };
  it("a DM shows the viewer's nickname for the peer when there is one", () => {
    expect(callLogTitle(log, { "01ABC": "Bé Ba" })).toBe("Bé Ba");
    expect(callLogTitle(log, {})).toBe("Chat B");
  });
  it("a room shows its name, or the caller when it has none", () => {
    expect(callLogTitle({ ...log, room_kind: "group", room_name: "Team" }, { "01ABC": "Bé Ba" })).toBe("Team");
    expect(callLogTitle({ ...log, room_kind: "group", room_name: "", peer_user_id: undefined }, {})).toBe("Chat A");
  });
});

describe("formatCallTime", () => {
  const now = new Date(2026, 9, 17, 15, 0);
  it("today shows the time, an earlier day the date, another year the year too", () => {
    const today = formatCallTime(new Date(2026, 9, 17, 9, 5).toISOString(), "vi", now);
    expect(today).toMatch(/09:05/);
    const earlier = formatCallTime(new Date(2026, 9, 3, 9, 5).toISOString(), "vi", now);
    expect(earlier).toMatch(/03/);
    expect(earlier).not.toMatch(/09:05|2026/);
    expect(formatCallTime(new Date(2025, 0, 3).toISOString(), "vi", now)).toMatch(/2025/);
  });
  it("an unreadable time is left blank", () => {
    expect(formatCallTime("", "en", now)).toBe("");
  });
});

describe("formatCallClock", () => {
  it("shows the time of day whatever the day, blank when unreadable", () => {
    expect(formatCallClock(new Date(2025, 0, 3, 17, 32).toISOString(), "vi")).toMatch(/17:32/);
    expect(formatCallClock("", "vi")).toBe("");
    expect(formatCallClock("not a date", "vi")).toBe("");
  });
});

describe("callLogSections", () => {
  const now = new Date(2026, 9, 17, 15, 0);
  const labels = { today: "Hôm nay", yesterday: "Hôm qua" };
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
  const log = (id: string, ended_at: string, outcome = "completed", caller = "peer") => ({ id, ended_at, ...call(outcome, caller) });
  const logs = [
    log("a", at(17, 10), "unanswered"),
    log("b", at(17, 9)),
    log("c", at(16, 17), "unanswered", "me"),
    log("d", at(16, 15), "unanswered"),
    log("e", at(1, 14)),
  ];
  const shape = (sections: ReturnType<typeof callLogSections<(typeof logs)[number]>>) =>
    sections.map((section) => [section.title, section.data.map((row) => row.id).join("")]);

  it("heads each calendar day once, in the server's order, titled like the room's day divider", () => {
    const sections = callLogSections(logs, { userId: "me", filter: "all", locale: "vi", labels, now });
    expect(shape(sections).slice(0, 2)).toEqual([
      ["Hôm nay", "ab"],
      ["Hôm qua", "cd"],
    ]);
    expect(sections[2]?.data.map((row) => row.id)).toEqual(["e"]);
    expect(sections[2]?.title).toMatch(/1/);
  });

  it("missed keeps only the calls the viewer missed, never the ones they cancelled", () => {
    expect(shape(callLogSections(logs, { userId: "me", filter: "missed", locale: "vi", labels, now }))).toEqual([
      ["Hôm nay", "a"],
      ["Hôm qua", "d"],
    ]);
  });

  it("an unreadable time joins an untitled group instead of a wrong day", () => {
    expect(shape(callLogSections([log("x", "")], { userId: "me", filter: "all", locale: "vi", labels, now }))).toEqual([["", "x"]]);
  });
});

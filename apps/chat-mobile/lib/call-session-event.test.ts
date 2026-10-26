import { describe, expect, it } from "vitest";
import { answeredCallLink, callSessionEventFrom, type SessionCall } from "./call-session-event";
import { parseDeepLink } from "./deep-link";

const FIELDS = { callId: "c-1", roomId: "r-1", workspaceId: "w-1", orgSlug: "acme", wsSlug: "hq", callerName: "Minh", video: true };
const CALL: SessionCall = FIELDS;

describe("callSessionEventFrom", () => {
  it("reads the system's Answer, Decline and End with the call they are about", () => {
    expect(callSessionEventFrom({ type: "answered", ...FIELDS })).toEqual({ type: "answered", call: CALL });
    expect(callSessionEventFrom({ type: "declined", ...FIELDS })).toEqual({ type: "declined", call: CALL });
    expect(callSessionEventFrom({ type: "ended", callId: "c-2" })).toEqual({
      type: "ended",
      call: { callId: "c-2", roomId: "", workspaceId: "", orgSlug: "", wsSlug: "", callerName: "", video: false },
    });
  });

  it("reads the token, mute, hold and audio events", () => {
    expect(callSessionEventFrom({ type: "token", token: "ab12" })).toEqual({ type: "token", token: "ab12" });
    expect(callSessionEventFrom({ type: "token", token: "" })).toEqual({ type: "token", token: "" });
    expect(callSessionEventFrom({ type: "muted", callId: "c-1", muted: true })).toEqual({ type: "muted", callId: "c-1", muted: true });
    expect(callSessionEventFrom({ type: "held", callId: "c-1", held: false })).toEqual({ type: "held", callId: "c-1", held: false });
    expect(callSessionEventFrom({ type: "held", held: true })).toEqual({ type: "held", callId: "", held: true });
    expect(callSessionEventFrom({ type: "audio", active: true })).toEqual({ type: "audio", active: true });
  });

  it("drops what is not an event it knows, or lacks what the event needs", () => {
    for (const value of [
      null,
      "answered",
      [],
      { type: "rang" },
      { type: "token", token: 1 },
      { type: "answered", callId: "" },
      { type: "declined", roomId: "r-1" },
      { type: "muted", muted: true },
      { type: "muted", callId: "c-1", muted: "yes" },
      { type: "held", callId: "c-1" },
      { type: "audio", active: 1 },
    ]) {
      expect(callSessionEventFrom(value)).toBeNull();
    }
  });
});

describe("answeredCallLink", () => {
  it("opens the call's room with the call, a link the deep-link parser reads back", () => {
    const link = answeredCallLink("uniworkchat", CALL);
    expect(link).toBe(`uniworkchat://open?url=${encodeURIComponent("/acme/hq/chat?room=r-1&call=c-1")}`);
    expect(parseDeepLink(link ?? "", "https://app.test", "uniworkchat")).toEqual({ orgSlug: "acme", wsSlug: "hq", roomId: "r-1", callId: "c-1" });
  });

  it("escapes what it puts in the query", () => {
    const link = answeredCallLink("uniworkchat", { ...CALL, roomId: "r&1", callId: "c=1" });
    expect(parseDeepLink(link ?? "", "https://app.test", "uniworkchat")).toMatchObject({ roomId: "r&1", callId: "c=1" });
  });

  it("has nothing to open without the workspace or the room", () => {
    expect(answeredCallLink("uniworkchat", { ...CALL, orgSlug: "" })).toBeNull();
    expect(answeredCallLink("uniworkchat", { ...CALL, wsSlug: "" })).toBeNull();
    expect(answeredCallLink("uniworkchat", { ...CALL, roomId: "" })).toBeNull();
  });
});

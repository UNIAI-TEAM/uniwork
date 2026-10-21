import { describe, expect, it } from "vitest";
import { CALL_RING_WINDOW_MS, appLink, callLink, callPushFromData, ringRemainingMs, taskPayloadData, type CallPush } from "./call-push";
import { parseDeepLink } from "./deep-link";

// What server notification/push_expo.go › callData sends (every value a string).
const INVITE = {
  type: "call_invite",
  call_id: "c-1",
  room_id: "r-1",
  workspace_id: "w-1",
  caller_name: "Minh",
  room_name: "Đội gọi",
  call_kind: "group",
  video: "1",
  expires_at: "1700000060000",
  url: "https://app.uniworkos.com/acme/hq/chat?room=r-1&call=c-1",
  tag: "chat_call:r-1",
};

type Invite = Extract<CallPush, { type: "call_invite" }>;

describe("callPushFromData", () => {
  it("reads a ring with its names, kind, camera and end", () => {
    expect(callPushFromData(INVITE)).toEqual({
      type: "call_invite",
      callId: "c-1",
      roomId: "r-1",
      workspaceId: "w-1",
      callerName: "Minh",
      roomName: "Đội gọi",
      callKind: "group",
      video: true,
      expiresAt: 1700000060000,
      url: INVITE.url,
    });
  });

  it("reads a sparse or odd ring leniently: a DM, no camera, no end, no names", () => {
    expect(callPushFromData({ type: "call_invite", call_id: "c", room_id: "r", call_kind: "weird", video: "0", expires_at: "soon", caller_name: 7 })).toEqual({
      type: "call_invite",
      callId: "c",
      roomId: "r",
      workspaceId: "",
      callerName: "",
      roomName: "",
      callKind: "dm",
      video: false,
      expiresAt: 0,
      url: "",
    });
    expect((callPushFromData({ ...INVITE, call_kind: "channel", expires_at: "-5" }) as Invite).callKind).toBe("channel");
    expect((callPushFromData({ ...INVITE, expires_at: "-5" }) as Invite).expiresAt).toBe(0);
  });

  it("reads the end of a ring and a missed call", () => {
    expect(callPushFromData({ type: "call_end", call_id: "c", room_id: "r", workspace_id: "w" })).toEqual({ type: "call_end", callId: "c", roomId: "r", workspaceId: "w" });
    expect(callPushFromData({ type: "call_missed", call_id: "c", room_id: "r", url: "https://x" })).toEqual({
      type: "call_missed",
      callId: "c",
      roomId: "r",
      workspaceId: "",
      url: "https://x",
    });
  });

  it("is null for anything that is not a call push", () => {
    for (const data of [null, undefined, "x", [], {}, { url: "https://x", tag: "t" }, { ...INVITE, type: "call_maybe" }, { ...INVITE, call_id: "" }, { ...INVITE, room_id: 3 }]) {
      expect(callPushFromData(data)).toBeNull();
    }
  });
});

describe("taskPayloadData", () => {
  const json = JSON.stringify(INVITE);

  it("finds Expo's JSON however deep the task's payload put it", () => {
    expect(taskPayloadData({ data: { dataString: json } })).toEqual(INVITE);
    expect(taskPayloadData({ data: { body: json, experienceId: "@x/y" } })).toEqual(INVITE);
    expect(taskPayloadData({ collapseKey: null, data: { data: { dataString: json } }, notification: null })).toEqual(INVITE);
    expect(taskPayloadData({ dataString: json })).toEqual(INVITE);
    // The job that restarts a killed app wraps it once more.
    expect(taskPayloadData({ notification: { data: { dataString: json } } })).toEqual(INVITE);
  });

  it("stops looking a few levels down", () => {
    expect(taskPayloadData({ data: { data: { data: { dataString: json } } } })).toBeNull();
  });

  it("takes a payload that already is the data", () => {
    expect(taskPayloadData({ data: INVITE })).toEqual(INVITE);
  });

  it("is null without a call's data", () => {
    for (const payload of [null, "x", {}, { data: null }, { data: { dataString: "{not json" } }, { data: { body: "[1]" } }, { data: { type: "call_end" } }]) {
      expect(taskPayloadData(payload)).toBeNull();
    }
  });
});

describe("ringRemainingMs", () => {
  const invite = callPushFromData(INVITE) as Invite;

  it("is the time left to the ring's end, never more than the window, never negative", () => {
    expect(ringRemainingMs(invite, 1700000060000 - 20_000)).toBe(20_000);
    expect(ringRemainingMs(invite, 1700000060000 - 5 * 60_000)).toBe(CALL_RING_WINDOW_MS);
    expect(ringRemainingMs(invite, 1700000060000 + 1)).toBe(0);
  });

  it("is the whole window when the push named no end", () => {
    expect(ringRemainingMs({ ...invite, expiresAt: 0 }, 5)).toBe(CALL_RING_WINDOW_MS);
  });
});

describe("callLink and appLink", () => {
  it("adds or drops answer=1 on the call's web link", () => {
    expect(callLink(INVITE.url, true)).toBe(`${INVITE.url}&answer=1`);
    expect(callLink(`${INVITE.url}&answer=1`, false)).toBe(INVITE.url);
    expect(callLink("not a url", true)).toBe("not a url");
  });

  it("wraps it in the scheme link lib/deep-link.ts opens, answer and all", () => {
    const link = appLink("uniworkchat", callLink(INVITE.url, true));
    expect(link.startsWith("uniworkchat://open?url=https%3A%2F%2Fapp.uniworkos.com%2F")).toBe(true);
    expect(parseDeepLink(link, "https://app.uniworkos.com", "uniworkchat")).toEqual({ orgSlug: "acme", wsSlug: "hq", roomId: "r-1", callId: "c-1", answer: true });
  });
});

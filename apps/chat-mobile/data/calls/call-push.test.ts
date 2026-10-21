import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallPush } from "@/lib/call-push";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import { handleCallPush, incomingCallSpec, incomingSpecFromState, type CallPushEnv } from "./call-push";

type Invite = Extract<CallPush, { type: "call_invite" }>;

const NOW = 1_700_000_000_000;
const URL = "https://app.uniworkos.com/acme/hq/chat?room=r-1&call=c-1";
const invite = (over: Partial<Invite> = {}): Invite => ({
  type: "call_invite",
  callId: "c-1",
  roomId: "r-1",
  workspaceId: "w-1",
  callerName: "Minh",
  roomName: "",
  callKind: "dm",
  video: false,
  expiresAt: NOW + 40_000,
  url: URL,
  ...over,
});

let state: VoiceCallOverlayState;
let afterSync: VoiceCallOverlayState | null;

function env(over: Partial<CallPushEnv> = {}): CallPushEnv {
  return {
    native: { showIncomingCall: vi.fn(() => true), cancelIncomingCall: vi.fn() },
    fallback: { show: vi.fn(async () => undefined), dismiss: vi.fn(async () => undefined) },
    appActive: () => false,
    callsOn: () => true,
    engine: {
      current: () => state,
      contextWorkspaceId: () => "w-1",
      syncPendingInvites: vi.fn(async () => {
        if (afterSync) state = afterSync;
      }),
    },
    ensureChannels: vi.fn(),
    t: (key, options) => (options ? `${key} ${JSON.stringify(options)}` : key),
    scheme: "uniworkchat",
    now: () => NOW,
    ...over,
  };
}

beforeEach(() => {
  state = { status: "idle" };
  afterSync = null;
});

describe("incomingCallSpec", () => {
  it("names a voice or video call, a group call by its room, and an unnamed caller", () => {
    const e = env();
    expect(incomingCallSpec(invite(), e)).toEqual({
      callId: "c-1",
      roomId: "r-1",
      workspaceId: "w-1",
      callerName: "Minh",
      callKind: "dm",
      text: "mobile.call_notify.incoming_voice",
      video: false,
      openUrl: `uniworkchat://open?url=${encodeURIComponent(URL)}`,
      timeoutMs: 40_000,
      answerLabel: "chat.voice_call_accept",
      declineLabel: "chat.voice_call_decline",
    });
    expect(incomingCallSpec(invite({ video: true }), e).text).toBe("mobile.call_notify.incoming_video");
    expect(incomingCallSpec(invite({ callKind: "group", roomName: "Đội" }), e).text).toBe('mobile.call_notify.incoming_group {"room":"Đội"}');
    expect(incomingCallSpec(invite({ callKind: "channel" }), e).text).toBe('mobile.call_notify.incoming_group {"room":"mobile.call_notify.group_fallback"}');
    expect(incomingCallSpec(invite({ callerName: "" }), e).callerName).toBe("mobile.call_notify.unknown_caller");
  });
});

describe("incomingSpecFromState", () => {
  const chatUrl = "https://app.uniworkos.com/acme/hq/chat";

  it("rings a DM the call screen had in the notification, named for the caller", () => {
    const spec = incomingSpecFromState({ status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" }, chatUrl, "w-1", env());
    expect(spec).toMatchObject({ callId: "c-1", roomId: "r-1", workspaceId: "w-1", callerName: "Minh", callKind: "dm", text: "mobile.call_notify.incoming_voice", timeoutMs: 60_000 });
    expect(spec.openUrl).toBe(`uniworkchat://open?url=${encodeURIComponent(`${chatUrl}?room=r-1&call=c-1`)}`);
  });

  it("names a group call by its caller and room", () => {
    const e = env();
    const spec = incomingSpecFromState({ status: "incoming", callId: "c-2", roomId: "g 1", peerName: "Đội", callKind: "group", callerName: "An" }, chatUrl, "w-1", e);
    expect(spec).toMatchObject({ callerName: "An", text: 'mobile.call_notify.incoming_group {"room":"Đội"}' });
    const target = new globalThis.URL(decodeURIComponent(spec.openUrl.split("url=")[1] ?? ""));
    expect(target.searchParams.get("room")).toBe("g 1");
    const unnamed = incomingSpecFromState({ status: "incoming", callId: "c-3", roomId: "g", peerName: "Đội", callKind: "channel" }, chatUrl, "w-1", e);
    expect(unnamed.callerName).toBe("mobile.call_notify.unknown_caller");
  });
});

describe("handleCallPush", () => {
  it("rings a closed or backgrounded app with its own notification, channels first", async () => {
    const e = env();
    expect(await handleCallPush(invite(), e)).toBe("shown");
    expect(e.ensureChannels).toHaveBeenCalledTimes(1);
    expect(vi.mocked(e.ensureChannels).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(e.native.showIncomingCall).mock.invocationCallOrder[0] ?? 0);
    expect(e.native.showIncomingCall).toHaveBeenCalledWith(expect.objectContaining({ callId: "c-1", timeoutMs: 40_000 }));
    expect(e.engine.syncPendingInvites).not.toHaveBeenCalled();
  });

  it("falls back to a plain notification that opens the ringing screen when the native one is not shown", async () => {
    // A build without the native module, or a post the system refused: a
    // data-only ring must never be dropped without a trace.
    const e = env();
    vi.mocked(e.native.showIncomingCall).mockReturnValue(false);
    expect(await handleCallPush(invite(), e)).toBe("fallback");
    expect(e.fallback.show).toHaveBeenCalledWith(expect.objectContaining({ callId: "c-1", callerName: "Minh", text: "mobile.call_notify.incoming_voice" }), URL);
  });

  it("is ignored when even the plain notification cannot be posted (no permission)", async () => {
    const e = env();
    vi.mocked(e.native.showIncomingCall).mockReturnValue(false);
    vi.mocked(e.fallback.show).mockRejectedValueOnce(new Error("denied"));
    expect(await handleCallPush(invite(), e)).toBe("ignored");
  });

  it("does not fall back when the native notification is shown", async () => {
    const e = env();
    expect(await handleCallPush(invite(), e)).toBe("shown");
    expect(e.fallback.show).not.toHaveBeenCalled();
  });

  it("does not ring with the calls switch off, for a ring that is over, or without a link", async () => {
    for (const [push, over] of [
      [invite(), { callsOn: () => false }],
      [invite({ expiresAt: NOW - 1 }), {}],
      [invite({ url: "" }), {}],
    ] as const) {
      const e = env(over);
      expect(await handleCallPush(push, e)).toBe("ignored");
      expect(e.native.showIncomingCall).not.toHaveBeenCalled();
    }
  });

  it("leaves a call the call screen already has, and says nothing over another call", async () => {
    state = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" };
    const same = env();
    expect(await handleCallPush(invite(), same)).toBe("in_app");
    state = { status: "active", callId: "other", roomId: "r-2", peerName: "Lan", token: "t", url: "u", outgoing: true, callKind: "dm" };
    const busy = env();
    expect(await handleCallPush(invite(), busy)).toBe("ignored");
    expect(busy.native.showIncomingCall).not.toHaveBeenCalled();
  });

  it("on screen, lets the workspace's own ring take a call it knows", async () => {
    afterSync = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" };
    const e = env({ appActive: () => true });
    expect(await handleCallPush(invite(), e)).toBe("in_app");
    expect(e.engine.syncPendingInvites).toHaveBeenCalledTimes(1);
    expect(e.native.showIncomingCall).not.toHaveBeenCalled();
  });

  it("on screen, rings a call of another workspace as a heads-up notification", async () => {
    const e = env({ appActive: () => true });
    vi.mocked(e.engine.syncPendingInvites).mockRejectedValueOnce(new Error("offline"));
    expect(await handleCallPush(invite(), e)).toBe("shown");
    // The workspace picker: no workspace open, straight to the notification.
    const picker = env({ appActive: () => true, engine: { ...env().engine, contextWorkspaceId: () => null } });
    expect(await handleCallPush(invite(), picker)).toBe("shown");
    expect(picker.engine.syncPendingInvites).not.toHaveBeenCalled();
  });

  it("takes the ringing notification down at the end of a ring or a missed call", async () => {
    const e = env();
    expect(await handleCallPush({ type: "call_end", callId: "c-1", roomId: "r-1", workspaceId: "w-1" }, e)).toBe("cleared");
    expect(await handleCallPush({ type: "call_missed", callId: "c-2", roomId: "r-1", workspaceId: "w-1", url: URL }, e)).toBe("cleared");
    expect(e.native.cancelIncomingCall).toHaveBeenNthCalledWith(1, "c-1");
    expect(e.native.cancelIncomingCall).toHaveBeenNthCalledWith(2, "c-2");
    expect(e.fallback.dismiss).toHaveBeenNthCalledWith(1, "c-1");
    expect(e.fallback.dismiss).toHaveBeenNthCalledWith(2, "c-2");
  });

  it("still clears when the plain notification cannot be dismissed", async () => {
    const e = env();
    vi.mocked(e.fallback.dismiss).mockRejectedValueOnce(new Error("gone"));
    expect(await handleCallPush({ type: "call_end", callId: "c-1", roomId: "r-1", workspaceId: "w-1" }, e)).toBe("cleared");
  });
});

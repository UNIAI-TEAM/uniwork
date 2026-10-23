import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import { installGroupDecline } from "./group-decline";

const group: VoiceCallOverlayState = { status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Đội", callKind: "group" };

function setup(workspaceId: string | null = "w-1") {
  const store = createStore<{ call: VoiceCallOverlayState }>(() => ({ call: { status: "idle" } }));
  const decline = vi.fn(async () => true);
  const stop = installGroupDecline(store, { decline, workspaceId: () => workspaceId });
  return { decline, stop, set: (call: VoiceCallOverlayState) => store.setState({ call }) };
}

describe("installGroupDecline", () => {
  it("tells the server when a group or channel call ringing on screen is declined", () => {
    const { decline, set } = setup();
    set(group);
    set({ status: "idle" });
    set({ ...group, callId: "c-2", callKind: "channel" });
    set({ status: "idle" });
    expect(decline.mock.calls).toEqual([
      ["w-1", "r-1", "c-1"],
      ["w-1", "r-1", "c-2"],
    ]);
  });

  it("says nothing for a 1-1 call (its Decline is the hangup), an answer, a missed ring, or without a workspace", () => {
    const { decline, set, stop } = setup();
    set({ ...group, callKind: "dm" });
    set({ status: "idle" });
    set(group);
    set({ status: "connecting", callId: "c-1", roomId: "r-1", peerName: "Đội", outgoing: false, callKind: "group" });
    set(group);
    set({ status: "ended", reason: "missed", callId: "c-1", roomId: "r-1", peerName: "Đội", callKind: "group", outgoing: false });
    expect(decline).not.toHaveBeenCalled();
    stop();
    set(group);
    set({ status: "idle" });
    expect(decline).not.toHaveBeenCalled();
    const none = setup(null);
    none.set(group);
    none.set({ status: "idle" });
    expect(none.decline).not.toHaveBeenCalled();
  });

  it("keeps a decline that fails as a breadcrumb", async () => {
    const { decline, set } = setup();
    decline.mockRejectedValueOnce(new Error("offline"));
    set(group);
    set({ status: "idle" });
    await Promise.resolve();
    expect(decline).toHaveBeenCalledTimes(1);
  });
});

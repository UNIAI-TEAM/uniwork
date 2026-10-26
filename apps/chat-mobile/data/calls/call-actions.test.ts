import { describe, expect, it, vi } from "vitest";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import { callActionFrom, handleCallAction, type CallActionEnv } from "./call-actions";

const NOW = 1_700_000_000_000;
const decline = { action: "decline", callId: "c-1", roomId: "r-1", workspaceId: "w-1", callKind: "dm", at: NOW - 1_000 };

function env(state: VoiceCallOverlayState = { status: "idle" }): CallActionEnv {
  return { engine: { current: () => state, hangUp: vi.fn(async () => undefined) }, declineOnServer: vi.fn(async () => undefined), now: () => NOW };
}

describe("callActionFrom", () => {
  it("reads a Decline or Hang up from the task's data", () => {
    expect(callActionFrom(decline)).toEqual(decline);
    expect(callActionFrom({ action: "hangup", callId: "c", at: "soon" })).toEqual({ action: "hangup", callId: "c", roomId: "", workspaceId: "", callKind: "", at: 0 });
    expect(callActionFrom({ ...decline, at: Number.NaN })?.at).toBe(0);
  });

  it("is null for anything else", () => {
    for (const value of [null, "decline", {}, { action: "answer", callId: "c" }, { action: "decline", callId: "" }, { action: "decline", callId: 4 }]) {
      expect(callActionFrom(value)).toBeNull();
    }
  });
});

describe("handleCallAction", () => {
  it("hands the call the app is ringing or in to the engine", async () => {
    const ringing = env({ status: "incoming", callId: "c-1", roomId: "r-1", peerName: "Minh", callKind: "dm" });
    expect(await handleCallAction(decline, ringing)).toBe("engine");
    expect(ringing.engine.hangUp).toHaveBeenCalledTimes(1);
    expect(ringing.declineOnServer).not.toHaveBeenCalled();
    const live = env({ status: "active", callId: "c-1", roomId: "r-1", peerName: "Minh", token: "t", url: "u", outgoing: false, callKind: "dm" });
    expect(await handleCallAction({ ...decline, action: "hangup", callKind: "" }, live)).toBe("engine");
  });

  it("declines a 1-1 call on the server when the app was not ringing it", async () => {
    const closed = env({ status: "ended", reason: "missed", roomId: "r", peerName: "x", callKind: "dm", outgoing: false });
    expect(await handleCallAction(decline, closed)).toBe("server");
    expect(closed.declineOnServer).toHaveBeenCalledWith("w-1", "r-1", "c-1");
  });

  it("declines a group or channel call on the server too: it goes on without the person and stops ringing elsewhere", async () => {
    for (const callKind of ["group", "channel"]) {
      const e = env();
      expect(await handleCallAction({ ...decline, callKind }, e)).toBe("server");
      expect(e.declineOnServer).toHaveBeenCalledWith("w-1", "r-1", "c-1");
    }
  });

  it("leaves a stale tap, a hang-up of a gone call and an incomplete one alone", async () => {
    for (const action of [
      { ...decline, at: NOW - 61_000 },
      { ...decline, action: "hangup" },
      { ...decline, workspaceId: "" },
      { ...decline, roomId: "" },
    ]) {
      const e = env();
      expect(await handleCallAction(action, e)).toBe("ignored");
      expect(e.declineOnServer).not.toHaveBeenCalled();
    }
  });
});

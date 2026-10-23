import { describe, expect, it } from "vitest";
import { callHoldsSocket } from "./call-socket";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";

const call = { callId: "c", roomId: "r", peerName: "An", callKind: "dm" } as const;

describe("callHoldsSocket", () => {
  it("holds the socket while a call rings, connects or is on; not when there is none or it ended", () => {
    const states: [VoiceCallOverlayState, boolean][] = [
      [{ status: "idle" }, false],
      [{ status: "incoming", ...call }, true],
      [{ status: "ringing", ...call, outgoing: true }, true],
      [{ status: "connecting", ...call, outgoing: true }, true],
      [{ status: "active", ...call, outgoing: true, token: "t", url: "wss://lk" }, true],
      [{ status: "ended", reason: "peer_ended", ...call, outgoing: true }, false],
    ];
    for (const [state, holds] of states) expect(callHoldsSocket(state)).toBe(holds);
  });
});

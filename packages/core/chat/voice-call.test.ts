import { describe, expect, it } from "vitest";
import { liveKitVoiceRoomFromMatrixRoom } from "./voice-call";

describe("liveKitVoiceRoomFromMatrixRoom", () => {
  it("sanitizes Matrix room ids for LiveKit", () => {
    const room = liveKitVoiceRoomFromMatrixRoom("!PDBezmTDyDMTsEIAGl:localhost");
    expect(room.startsWith("uw-voice-")).toBe(true);
    expect(room.includes("!")).toBe(false);
    expect(room.includes(":")).toBe(false);
    expect(liveKitVoiceRoomFromMatrixRoom("!PDBezmTDyDMTsEIAGl:localhost")).toBe(room);
  });
});

import { describe, expect, it } from "vitest";
import { sameParticipantTiles, type VoiceCallParticipantTile } from "./voice-call-room-types";

const tile = (patch: Partial<VoiceCallParticipantTile> = {}): VoiceCallParticipantTile => ({
  identity: "a",
  name: "An",
  isLocal: false,
  hasVideo: false,
  hasScreenShare: false,
  isSpeaking: false,
  micMuted: false,
  ...patch,
});

describe("sameParticipantTiles", () => {
  it("treats a speaker update that changes nothing visible as the same tiles", () => {
    expect(sameParticipantTiles([tile()], [tile({ isSpeaking: undefined })])).toBe(true);
  });

  it("notices a change a tile shows", () => {
    expect(sameParticipantTiles([tile()], [tile({ isSpeaking: true })])).toBe(false);
    expect(sameParticipantTiles([tile()], [tile(), tile({ identity: "b" })])).toBe(false);
  });
});

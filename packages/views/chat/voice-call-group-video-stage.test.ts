import { describe, expect, it } from "vitest";
import {
  groupParticipantGridClass,
  voiceCallParticipantStripTileClass,
} from "./voice-call-group-video-stage";

describe("groupParticipantGridClass", () => {
  it("uses one column for a solo tile", () => {
    expect(groupParticipantGridClass(1, "compact")).toBe("grid-cols-1");
    expect(groupParticipantGridClass(1, "fullscreen")).toBe("grid-cols-1");
  });

  it("uses two equal columns for pairs", () => {
    expect(groupParticipantGridClass(2, "compact")).toBe("grid-cols-2");
    expect(groupParticipantGridClass(2, "fullscreen")).toBe("grid-cols-1 sm:grid-cols-2");
  });

  it("uses three columns in compact mode for trios", () => {
    expect(groupParticipantGridClass(3, "compact")).toBe("grid-cols-3");
  });

  it("uses a 2x2 grid for four participants", () => {
    expect(groupParticipantGridClass(4, "compact")).toBe("grid-cols-2");
    expect(groupParticipantGridClass(4, "fullscreen")).toBe("grid-cols-2");
  });
});

describe("voiceCallParticipantStripTileClass", () => {
  it("keeps strip tiles wide enough for faces while screen sharing", () => {
    expect(voiceCallParticipantStripTileClass).toMatch(/h-\[/);
    expect(voiceCallParticipantStripTileClass).toMatch(/w-\[/);
    expect(voiceCallParticipantStripTileClass).toContain("shrink-0");
  });
});

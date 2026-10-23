import { describe, expect, it } from "vitest";
import { formatVoiceCallDuration } from "./voice-call-duration";

describe("formatVoiceCallDuration", () => {
  it("formats sub-minute durations as M:SS", () => {
    expect(formatVoiceCallDuration(0)).toBe("0:00");
    expect(formatVoiceCallDuration(9)).toBe("0:09");
    expect(formatVoiceCallDuration(65)).toBe("1:05");
  });

  it("formats hour-long durations as H:MM:SS", () => {
    expect(formatVoiceCallDuration(3661)).toBe("1:01:01");
  });

  it("clamps negative values to zero", () => {
    expect(formatVoiceCallDuration(-12)).toBe("0:00");
  });
});

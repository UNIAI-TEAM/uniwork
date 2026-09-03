import { describe, expect, it } from "vitest";
import { createVoiceCallId } from "./voice-call";

describe("voice-call", () => {
  it("createVoiceCallId returns a uuid", () => {
    const id = createVoiceCallId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

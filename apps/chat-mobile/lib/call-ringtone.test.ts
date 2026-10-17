import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RINGTONES, ringtoneFor, ringtoneWav, type CallRingtoneKind } from "./call-ringtone";

const file = (kind: CallRingtoneKind) => path.resolve(__dirname, `../assets/sounds/ring-${kind}.wav`);

describe("call ringtones", () => {
  // The web's use-call-ringtone.ts schedules exactly these oscillators.
  it("keeps the web's tones and loop", () => {
    expect(RINGTONES.incoming).toEqual({
      tones: [
        { frequency: 440, ms: 180, atMs: 0 },
        { frequency: 480, ms: 180, atMs: 220 },
      ],
      loopMs: 2200,
    });
    expect(RINGTONES.outgoing).toEqual({
      tones: [
        { frequency: 400, ms: 320, atMs: 0 },
        { frequency: 350, ms: 320, atMs: 380 },
      ],
      loopMs: 1800,
    });
  });

  it.each(["incoming", "outgoing"] as const)("the %s file is the pattern rendered", (kind) => {
    const wav = ringtoneWav(kind);
    if (process.env.UPDATE_RINGTONES) fs.writeFileSync(file(kind), wav);
    expect(new Uint8Array(fs.readFileSync(file(kind)))).toEqual(wav);
    // One loop at 8 kHz, 16-bit: the header names that much data and silence ends it.
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(wav.length).toBe(44 + (RINGTONES[kind].loopMs / 1000) * 8000 * 2);
    expect(wav.at(-1)).toBe(0);
  });

  it("rings the callee and the caller only", () => {
    expect(ringtoneFor("incoming")).toBe("incoming");
    expect(ringtoneFor("ringing")).toBe("outgoing");
    expect(ringtoneFor("connecting")).toBeNull();
    expect(ringtoneFor("active")).toBeNull();
  });
});

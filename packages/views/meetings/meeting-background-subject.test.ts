import { describe, expect, it } from "vitest";
import {
  MASK_BACKGROUND,
  MASK_PERSON,
  MainSubjectMask,
} from "./meeting-background-subject";

type Rect = { x: number; y: number; w: number; h: number };

function maskWith(width: number, height: number, rects: Rect[]): Uint8Array {
  const mask = new Uint8Array(width * height).fill(MASK_BACKGROUND);
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) mask[y * width + x] = MASK_PERSON;
    }
  }
  return mask;
}

function personPixelsIn(mask: Uint8Array, width: number, r: Rect): number {
  let count = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) if (mask[y * width + x] === MASK_PERSON) count++;
  }
  return count;
}

const W = 640;
const H = 360;

describe("MainSubjectMask", () => {
  it("keeps a single person untouched", () => {
    const mask = maskWith(W, H, [{ x: 240, y: 80, w: 160, h: 280 }]);
    const out = new MainSubjectMask().filter(mask, W, H);
    expect(Array.from(out)).toEqual(Array.from(mask));
  });

  it("drops people behind the speaker who are not connected to them", () => {
    const speaker = { x: 240, y: 80, w: 160, h: 280 };
    const left = { x: 40, y: 150, w: 80, h: 120 };
    const right = { x: 500, y: 180, w: 90, h: 100 };
    const out = new MainSubjectMask().filter(maskWith(W, H, [speaker, left, right]), W, H);

    expect(personPixelsIn(out, W, speaker)).toBe(speaker.w * speaker.h);
    expect(personPixelsIn(out, W, left)).toBe(0);
    expect(personPixelsIn(out, W, right)).toBe(0);
  });

  it("keeps a hand joined to the body by a thin arm", () => {
    const body = { x: 240, y: 120, w: 160, h: 240 };
    const arm = { x: 400, y: 200, w: 60, h: 1 };
    const hand = { x: 460, y: 180, w: 30, h: 40 };
    const out = new MainSubjectMask().filter(maskWith(W, H, [body, arm, hand]), W, H);

    expect(personPixelsIn(out, W, hand)).toBe(hand.w * hand.h);
  });

  it("returns an all-background mask unchanged", () => {
    const mask = maskWith(W, H, []);
    expect(new MainSubjectMask().filter(mask, W, H).every((v) => v === MASK_BACKGROUND)).toBe(
      true,
    );
  });

  it("stays on the same person when someone slightly bigger walks in", () => {
    const subject = new MainSubjectMask();
    const speaker = { x: 60, y: 100, w: 150, h: 260 };
    subject.filter(maskWith(W, H, [speaker]), W, H);

    const passerBy = { x: 400, y: 90, w: 160, h: 270 };
    const out = subject.filter(maskWith(W, H, [speaker, passerBy]), W, H);

    expect(personPixelsIn(out, W, speaker)).toBe(speaker.w * speaker.h);
    expect(personPixelsIn(out, W, passerBy)).toBe(0);
  });

  it("follows a much bigger person once the speaker has left the frame", () => {
    const subject = new MainSubjectMask();
    subject.filter(maskWith(W, H, [{ x: 60, y: 100, w: 150, h: 260 }]), W, H);

    const newcomer = { x: 300, y: 40, w: 240, h: 320 };
    const leftover = { x: 20, y: 300, w: 30, h: 30 };
    const out = subject.filter(maskWith(W, H, [newcomer, leftover]), W, H);

    expect(personPixelsIn(out, W, newcomer)).toBe(newcomer.w * newcomer.h);
    expect(personPixelsIn(out, W, leftover)).toBe(0);
  });

  it("does not modify the mask it was given", () => {
    const mask = maskWith(W, H, [
      { x: 240, y: 80, w: 160, h: 280 },
      { x: 40, y: 150, w: 80, h: 120 },
    ]);
    const copy = mask.slice();
    new MainSubjectMask().filter(mask, W, H);
    expect(Array.from(mask)).toEqual(Array.from(copy));
  });
});

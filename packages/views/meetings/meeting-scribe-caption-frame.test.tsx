import { describe, expect, it } from "vitest";
import { clampFloat, FLOAT_MIN, resizeFloat, snapFloat } from "./meeting-scribe-caption-frame";

const room = { width: 1000, height: 600 };

describe("clampFloat", () => {
  it("keeps a floating box inside the room, between its minimum size and the room's width or 60% of its height", () => {
    expect(clampFloat({ x: -50, y: -50, width: 100, height: 50 }, room)).toEqual({ x: 12, y: 12, ...FLOAT_MIN });
    expect(clampFloat({ x: 900, y: 500, width: 2000, height: 900 }, room)).toEqual({ x: 12, y: 228, width: 976, height: 360 });
    expect(clampFloat({ x: 300, y: 200, width: 400, height: 160 }, room)).toEqual({ x: 300, y: 200, width: 400, height: 160 });
  });
});

describe("snapFloat", () => {
  it("sits a box dropped near an edge flush against it, and leaves one in the open where it was", () => {
    expect(snapFloat({ x: 25, y: 30, width: 400, height: 160 }, room)).toMatchObject({ x: 12, y: 12 });
    expect(snapFloat({ x: 580, y: 420, width: 400, height: 160 }, room)).toMatchObject({ x: 588, y: 428 });
    expect(snapFloat({ x: 300, y: 200, width: 400, height: 160 }, room)).toMatchObject({ x: 300, y: 200 });
  });
});

describe("resizeFloat", () => {
  const box = { x: 100, y: 100, width: 400, height: 200 };
  it("moves only the edges a handle holds, keeping the opposite ones where they are", () => {
    expect(resizeFloat(box, { x: 1, y: 0 }, 50, 30)).toEqual({ ...box, width: 450 });
    expect(resizeFloat(box, { x: -1, y: -1 }, -40, -20)).toEqual({ x: 60, y: 80, width: 440, height: 220 });
    expect(resizeFloat(box, { x: 0, y: 1 }, 0, 40)).toEqual({ ...box, height: 240 });
  });
  it("never goes below its minimum, the left edge stopping where the right one allows", () => {
    expect(resizeFloat(box, { x: -1, y: 0 }, 300, 0)).toEqual({ ...box, x: 180, width: FLOAT_MIN.width });
  });
});

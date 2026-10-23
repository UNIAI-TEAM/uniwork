// The inbox row's swipe (room-swipe.ts): right to mark read, left to reveal
// the buttons, each side only where the row has that action.
import { describe, expect, it } from "vitest";
import { ROOM_SWIPE_BUTTON, ROOM_SWIPE_FLICK, ROOM_SWIPE_READ, roomSwipeArmed, roomSwipeOffset, roomSwipeRelease } from "./room-swipe";

const BOTH = { leading: true, trailing: 2 };
const READ_ONLY = { leading: true, trailing: 0 };
const BUTTONS_ONLY = { leading: false, trailing: 2 };
const OPEN = -2 * ROOM_SWIPE_BUTTON;

describe("roomSwipeOffset", () => {
  it("follows the finger between the read threshold and the buttons' width", () => {
    expect(roomSwipeOffset(0, 30, BOTH)).toBe(30);
    expect(roomSwipeOffset(0, 400, BOTH)).toBe(ROOM_SWIPE_READ);
    expect(roomSwipeOffset(0, -400, BOTH)).toBe(OPEN);
  });

  it("does not move toward a side the row has no action on", () => {
    expect(roomSwipeOffset(0, 50, BUTTONS_ONLY)).toBe(0);
    expect(roomSwipeOffset(0, -50, READ_ONLY)).toBe(0);
  });

  it("starts an open row's drag from where its buttons hold it", () => {
    expect(roomSwipeOffset(OPEN, 40, BOTH)).toBe(OPEN + 40);
  });
});

describe("roomSwipeRelease", () => {
  it("marks read past the threshold, and only where there is something unread", () => {
    expect(roomSwipeRelease(ROOM_SWIPE_READ, 0, BOTH)).toBe("read");
    expect(roomSwipeRelease(ROOM_SWIPE_READ - 1, 0, BOTH)).toBe("close");
    expect(roomSwipeRelease(ROOM_SWIPE_READ, 0, BUTTONS_ONLY)).toBe("close");
  });

  it("opens the buttons past half their width or on a flick to the left, and closes otherwise", () => {
    expect(roomSwipeRelease(OPEN / 2, 0, BOTH)).toBe("open");
    expect(roomSwipeRelease(OPEN / 2 + 1, 0, BOTH)).toBe("close");
    expect(roomSwipeRelease(-10, -(ROOM_SWIPE_FLICK + 1), BOTH)).toBe("open");
    expect(roomSwipeRelease(OPEN + 5, ROOM_SWIPE_FLICK + 1, BOTH)).toBe("close");
    expect(roomSwipeRelease(-40, 0, READ_ONLY)).toBe("close");
    expect(roomSwipeRelease(0, -(ROOM_SWIPE_FLICK + 1), BOTH)).toBe("close");
  });
});

describe("roomSwipeArmed", () => {
  it("is armed past the point where letting go acts, on either side", () => {
    expect(roomSwipeArmed(ROOM_SWIPE_READ, BOTH)).toBe(true);
    expect(roomSwipeArmed(ROOM_SWIPE_READ - 1, BOTH)).toBe(false);
    expect(roomSwipeArmed(ROOM_SWIPE_READ, BUTTONS_ONLY)).toBe(false);
    expect(roomSwipeArmed(OPEN / 2, BOTH)).toBe(true);
    expect(roomSwipeArmed(OPEN / 2 + 1, BOTH)).toBe(false);
    expect(roomSwipeArmed(0, READ_ONLY)).toBe(false);
  });
});

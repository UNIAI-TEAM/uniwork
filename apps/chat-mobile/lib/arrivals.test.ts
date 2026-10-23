// What a screen reader hears as messages arrive, and how many the "N new"
// button counts (packages/views/chat/native-chat-live-region.tsx and
// native-chat-message-timeline.ts › countNewSince, same cases).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrivalAnnouncement, arrivedSince, countNewSince, createArrivalAnnouncer, type Arrival } from "./arrivals";
import type { TimelineMessage } from "./timeline-display";

const msg = (id: string, sender: string, pending = false): TimelineMessage =>
  ({ id, sender, body: id, ts: 0, ...(pending ? { pending: { status: "sending" } } : {}) }) as TimelineMessage;

const ME = "me";
const list = [msg("a", "u2"), msg("b", ME), msg("c", "u2"), msg("d", "u3")];

describe("arrivedSince", () => {
  it("says nothing for a first page, a new room or an unchanged bottom", () => {
    expect(arrivedSince(list, null, "r1", ME)).toEqual([]);
    expect(arrivedSince(list, { roomId: "r0", lastId: "a" }, "r1", ME)).toEqual([]);
    expect(arrivedSince(list, { roomId: "r1", lastId: null }, "r1", ME)).toEqual([]);
    expect(arrivedSince([], { roomId: "r1", lastId: "a" }, "r1", ME)).toEqual([]);
    expect(arrivedSince(list, { roomId: "r1", lastId: "d" }, "r1", ME)).toEqual([]);
  });

  it("returns what others sent below the old bottom, never mine or a pending one", () => {
    const next = [...list, msg("e", ME), msg("f", "u2"), msg("g", "u3", true)];
    expect(arrivedSince(next, { roomId: "r1", lastId: "d" }, "r1", ME).map((m) => m.id)).toEqual(["f"]);
    expect(arrivedSince(list, { roomId: "r1", lastId: "a" }, "r1", ME).map((m) => m.id)).toEqual(["c", "d"]);
  });

  it("is not an arrival when the old bottom is gone (a jump replaced the window)", () => {
    expect(arrivedSince(list, { roomId: "r1", lastId: "zz" }, "r1", ME)).toEqual([]);
  });
});

describe("countNewSince", () => {
  it("counts others' messages after the one the reader left at", () => {
    expect(countNewSince(list, "a", ME)).toBe(2);
    expect(countNewSince(list, "d", ME)).toBe(0);
    expect(countNewSince(list, null, ME)).toBe(0);
    expect(countNewSince(list, "zz", ME)).toBe(0);
  });
});

describe("arrivalAnnouncement", () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}${JSON.stringify(options)}`;
  it("names the sender and the text of one message, and counts several", () => {
    expect(arrivalAnnouncement([{ sender: "Bình", preview: "Chào" }], t)).toBe('chat.message_list.live_new_message{"sender":"Bình","preview":"Chào"}');
    expect(arrivalAnnouncement([{ sender: "Bình", preview: "1" }, { sender: "An", preview: "2" }], t)).toBe('mobile.a11y.new_messages{"count":2}');
    expect(arrivalAnnouncement([], t)).toBeNull();
  });
});

describe("createArrivalAnnouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const one = (n: number): Arrival[] => Array.from({ length: n }, (_, i) => ({ sender: `s${i}`, preview: `p${i}` }));

  it("speaks the first arrival at once, then gathers a burst into one line per window", () => {
    const speak = vi.fn();
    const announcer = createArrivalAnnouncer({ quietMs: 3000, speak });
    announcer.push(one(1));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenLastCalledWith(one(1));
    announcer.push(one(1));
    announcer.push(one(2));
    expect(speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak.mock.lastCall?.[0]).toHaveLength(3);
    // Quiet for a whole window: the next one is spoken at once again.
    vi.advanceTimersByTime(3000);
    announcer.push(one(1));
    expect(speak).toHaveBeenCalledTimes(3);
  });

  it("ignores an empty push and forgets what was waiting when disposed", () => {
    const speak = vi.fn();
    const announcer = createArrivalAnnouncer({ quietMs: 3000, speak });
    createArrivalAnnouncer({ quietMs: 3000, speak }).dispose();
    announcer.push([]);
    expect(speak).not.toHaveBeenCalled();
    announcer.push(one(1));
    announcer.push(one(1));
    announcer.dispose();
    vi.advanceTimersByTime(10_000);
    expect(speak).toHaveBeenCalledTimes(1);
  });
});

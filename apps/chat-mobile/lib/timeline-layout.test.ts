// The one-pass layout against the plain definitions it replaces on screen:
// the same rows (newest first), the same runs and albums, whatever the
// change; and the work it saves, counted — one read of each message, and the
// rows of every unchanged message handed back as the very same objects.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { albumsOf } from "./album";
import { continuedRunKeys } from "./conversation-display";
import { buildTimelineRows, toTimelineMessage, type TimelineMessage } from "./timeline-display";
import { layoutTimeline } from "./timeline-layout";

const T0 = new Date(2026, 9, 1, 8, 0).getTime();

/** A deterministic mix: four senders, texts, photos (some reacted to), polls, gaps that cross days. */
function conversation(count: number, seed = 1): TimelineMessage[] {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  let ts = T0;
  return Array.from({ length: count }, (_, n) => {
    const roll = next();
    ts += roll < 0.05 ? 20 * 3_600_000 : roll < 0.6 ? 30_000 : 200_000;
    const kind = roll < 0.5 ? "file" : roll < 0.55 ? "poll" : "text";
    return toTimelineMessage(
      ChatMessageSchema.parse({
        id: `m${String(n).padStart(5, "0")}`,
        room_id: "r1",
        workspace_id: "w1",
        sender_id: `u${Math.floor(next() * (roll < 0.5 ? 1.3 : 4))}`,
        sender_display_name: "x",
        kind,
        body: kind === "text" ? `tin ${n}` : "",
        created_at: new Date(ts).toISOString(),
        ...(kind === "file" ? { file: { id: `f${n}`, filename: `p${n}.jpg`, content_type: "image/jpeg", size_bytes: 1 } } : {}),
        ...(kind === "file" && next() < 0.1 ? { reactions: { "👍": 1 } } : {}),
        ...(kind === "poll" ? { poll: { question: "?", options: [], multiple_choice: false } } : {}),
      }),
    );
  });
}

/** What the plain definitions build, in the layout's shape. */
function plain(messages: TimelineMessage[]) {
  const rows = buildTimelineRows(messages);
  const albums = albumsOf(messages);
  return { rows: [...rows].reverse(), continued: continuedRunKeys(rows), albums, byId: new Map(messages.map((m) => [m.id, m])) };
}

/** `messages` behind a proxy that counts how many times an index is read. */
function counted(messages: TimelineMessage[]) {
  const reads = { count: 0 };
  const proxy = new Proxy(messages, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) reads.count += 1;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { proxy, reads };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("layoutTimeline", () => {
  it("lays out what the plain definitions do, newest first", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const messages = conversation(400, seed);
      const layout = layoutTimeline(messages);
      expect(layout).toEqual(plain(messages));
      // The mix has every rule at work: albums, runs, and several days.
      expect(layout.albums.byFirstId.size).toBeGreaterThan(5);
      expect(layout.continued.size).toBeGreaterThan(10);
      expect(layout.rows.filter((row) => row.type === "day").length).toBeGreaterThan(3);
    }
    expect(layoutTimeline([])).toEqual(plain([]));
  });

  it("stays equal to them across every kind of change: a new message, an older page, an edit in the middle, a removal", () => {
    const all = conversation(600, 7);
    let shown = all.slice(300, 500);
    const check = () => expect(layoutTimeline(shown)).toEqual(plain(shown));
    check();
    shown = [...shown, ...all.slice(500, 501)];
    check();
    shown = [...all.slice(250, 300), ...shown];
    check();
    const middle = shown[100] as TimelineMessage;
    shown = shown.map((m) => (m === middle ? { ...m, record: m.record && { ...m.record, reactions: { "❤️": 2 } } } : m));
    check();
    shown = shown.filter((_, index) => index !== 40 && index !== 41);
    check();
  });

  it("gathers at most ten photos an album, and starts the next one after", () => {
    const photos = Array.from({ length: 23 }, (_, n) =>
      toTimelineMessage(
        ChatMessageSchema.parse({
          id: `p${n}`,
          room_id: "r1",
          workspace_id: "w1",
          sender_id: "u1",
          sender_display_name: "x",
          kind: "file",
          body: "",
          created_at: new Date(T0 + n * 5_000).toISOString(),
          file: { id: `f${n}`, filename: `p${n}.jpg`, content_type: "image/jpeg", size_bytes: 1 },
        }),
      ),
    );
    const { albums } = layoutTimeline(photos);
    expect([...albums.byFirstId.keys()]).toEqual(["p0", "p10", "p20"]);
    expect(albums.byFirstId.get("p20")).toHaveLength(3);
    expect(albums.folded.size).toBe(20);
  });

  it("reads each message once, where the plain definitions make a pass per rule", () => {
    const messages = conversation(2000, 11);
    const layout = counted(messages);
    layoutTimeline(layout.proxy);
    expect(layout.reads.count).toBe(2000);
    const definitions = counted(messages);
    plain(definitions.proxy);
    expect(definitions.reads.count).toBeGreaterThan(4 * 2000);
  });

  it("hands back every unchanged message's rows as last time's objects, and builds a new message's alone", () => {
    const loaded = conversation(2000, 13);
    const before = layoutTimeline(loaded);
    const [arrived] = conversation(1, 14).map((m) => ({ ...m, id: "new", ts: (loaded.at(-1) as TimelineMessage).ts + 1_000 }));
    const after = layoutTimeline([...loaded, arrived as TimelineMessage]);
    const fresh = after.rows.filter((row) => !before.rows.includes(row));
    expect(fresh.map((row) => row.key)).toEqual(["new"]);
    expect(after.rows.slice(1)).toEqual(before.rows);
  });

  it("works the days out again once the time zone moves", () => {
    vi.useFakeTimers({ now: new Date(2030, 0, 15, 12, 0) });
    const messages = conversation(50, 17);
    const before = layoutTimeline(messages);
    expect(layoutTimeline(messages).rows[0]).toBe(before.rows[0]);
    const offset = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-600);
    vi.advanceTimersByTime(61_000);
    const moved = layoutTimeline(messages);
    expect(offset).toHaveBeenCalled();
    expect(moved.rows[0]).not.toBe(before.rows[0]);
    expect(moved.rows[0]).toEqual(before.rows[0]);
  });
});

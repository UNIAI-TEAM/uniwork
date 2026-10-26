import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installReportSink, type ReportSink } from "../report";
import { decodeFrame, FRAME_SCHEMAS, isKnownFrame, isKnownFrameType, type KnownFrameType } from "./frames";

// docs/events/CATALOGUE.md: one row per event, `name` | version | `key`, `key` | …
const catalogue = new Map<string, Set<string>>();
for (const line of readFileSync(path.resolve(__dirname, "../../../../docs/events/CATALOGUE.md"), "utf8").split("\n")) {
  const row = /^\| `([^`]+)` \| \d+ \| ([^|]*)\|/.exec(line);
  if (row) catalogue.set(row[1]!, new Set([...row[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)));
}

const TRANSPORT = new Set(["subscribe_ack", "subscribe_error"]);
const events = (Object.keys(FRAME_SCHEMAS) as KnownFrameType[]).filter((type) => !TRANSPORT.has(type));

/** A payload with every key the catalogue lists for the event, each a distinct id. */
const full = (type: string) => Object.fromEntries([...(catalogue.get(type) ?? [])].map((key) => [key, `${key}-1`]));
const shapeOf = (type: KnownFrameType) => (FRAME_SCHEMAS[type] as unknown as { shape: Record<string, { safeParse(v: unknown): { success: boolean } }> }).shape;
const required = (type: KnownFrameType) => Object.keys(shapeOf(type)).filter((key) => !shapeOf(type)[key]!.safeParse(undefined).success);

const sink = { captureException: vi.fn(), addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() } satisfies ReportSink;
afterEach(() => {
  installReportSink(null);
  vi.clearAllMocks();
});

describe("the frame decoders", () => {
  it("decode only catalogued events, and read only keys the catalogue lists for them", () => {
    for (const type of events) {
      expect(catalogue.has(type), `${type} is not in docs/events/CATALOGUE.md`).toBe(true);
      expect(Object.keys(shapeOf(type)).filter((key) => !catalogue.get(type)!.has(key)), type).toEqual([]);
    }
  });

  it.each(events)("%s: accepts the catalogue's payload and keeps keys it does not read", (type) => {
    const payload = { ...full(type), added_later: "x" };
    expect(decodeFrame({ type, payload, actor_id: "a1" })).toEqual({ type, payload, actor_id: "a1" });
  });

  it.each(events.filter((type) => required(type).length > 0))("%s: drops a frame missing an id it needs, or carrying an empty one", (type) => {
    for (const key of required(type)) {
      const { [key]: _gone, ...rest } = full(type);
      expect(decodeFrame({ type, payload: rest }), `${type} without ${key}`).toBeNull();
      expect(decodeFrame({ type, payload: { ...full(type), [key]: "" } }), `${type} with an empty ${key}`).toBeNull();
    }
  });

  it.each(events)("%s: drops a frame whose payload is not an object, or a key of the wrong type", (type) => {
    expect(decodeFrame({ type, payload: null })).toBeNull();
    expect(decodeFrame({ type, payload: "room-1" })).toBeNull();
    const [key] = Object.keys(shapeOf(type));
    if (key) expect(decodeFrame({ type, payload: { ...full(type), [key]: 7 } })).toBeNull();
  });

  it("decodes the transport frames of the scoped subscriptions", () => {
    expect(decodeFrame({ type: "subscribe_ack", payload: { scope: "chat", id: "r1" } })).toEqual({ type: "subscribe_ack", payload: { scope: "chat", id: "r1" } });
    expect(decodeFrame({ type: "subscribe_error", payload: { scope: "chat", id: "r1", error: "lookup_failed" } })).not.toBeNull();
    expect(decodeFrame({ type: "subscribe_error", payload: { scope: "chat" } })).toBeNull();
  });

  it("hands a frame of a type it does not list on untouched, whatever its payload", () => {
    const msg = { type: "task.updated", payload: 42 };
    expect(decodeFrame(msg)).toBe(msg);
    expect(isKnownFrame(msg)).toBe(false);
    expect(isKnownFrameType("toString")).toBe(false);
    expect(isKnownFrame({ type: "chat.typing", payload: { room_id: "r1", user_id: "u1" } })).toBe(true);
  });

  it("leaves a breadcrumb naming the event and the failing keys, never a value", () => {
    installReportSink(sink);
    decodeFrame({ type: "chat.typing", payload: { room_id: "secret room", user_id: 5 } });
    decodeFrame({ type: "user.offline", payload: null });
    expect(sink.addBreadcrumb.mock.calls.map(([crumb]) => crumb)).toEqual([
      { category: "realtime", message: "malformed frame dropped", level: "warning", data: { type: "chat.typing", fields: "user_id" } },
      { category: "realtime", message: "malformed frame dropped", level: "warning", data: { type: "user.offline", fields: "(payload)" } },
    ]);
    expect(JSON.stringify(sink.addBreadcrumb.mock.calls)).not.toContain("secret");
  });
});

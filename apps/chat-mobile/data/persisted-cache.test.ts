// The disk copy of the query cache is read like a network answer: every kept
// query through the schema that shaped it, a drifted one dropped alone.
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { ChatMessagesListSchema, ChatRoomsListSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { MembersSchema } from "./chat-api-schemas";
import { persistedRooms, readPersistedClient } from "./persisted-cache";
import { chatKeys } from "./queries/chat-keys";
import { shouldPersistQuery } from "./query-persister";

const rooms = ChatRoomsListSchema.parse({ rooms: [{ id: "r1", kind: "group", name: "G", workspace_id: "w1", member_user_ids: null }] }).rooms;
const message = (id: string) => ({ id, room_id: "r1", workspace_id: "w1", sender_id: "u1", sender_display_name: "A", body: id, created_at: "2026-10-20T00:00:00Z" });
const messages = (...ids: string[]) => ChatMessagesListSchema.parse({ messages: ids.map(message) }).messages;
const member = { user_id: "u1", role: "member", email: "a@x.vn", display_name: "A" };

/** Every kept key with the data its endpoint gave, through dehydrate and JSON as the persister writes it. */
function written(): unknown {
  const qc = new QueryClient();
  qc.setQueryData(["workspaces"], [{ id: "w1", slug: "w", name: "W", organization_id: "o", organization_slug: "o", organization_name: "O" }]);
  qc.setQueryData(chatKeys.rooms("w1"), rooms);
  qc.setQueryData(chatKeys.unreadSummary(), { direct: { unread: 1, mentions: 0 }, workspaces: [{ workspace_id: "w1", unread: 1, mentions: 0 }] });
  qc.setQueryData(chatKeys.nicknames("w1"), { U1: "Bình" });
  qc.setQueryData(chatKeys.members("w1"), [{ user_id: "u1", email: "", display_name: "A" }]);
  qc.setQueryData(chatKeys.roomMembers("w1", "r1"), MembersSchema.parse({ members: [member] }).members);
  qc.setQueryData(chatKeys.roomMessages("w1", "r1"), { pages: [messages("m2"), messages("m1")], pageParams: [null, { cursor: "c1" }] });
  return JSON.parse(JSON.stringify({ buster: "b", timestamp: 1, clientState: dehydrate(qc, { shouldDehydrateQuery: shouldPersistQuery }) }));
}

const queriesOf = (raw: unknown) => (raw as { clientState: { queries: Array<{ queryKey: unknown[]; state: Record<string, unknown> }> } }).clientState.queries;

function withData(raw: unknown, key: readonly unknown[], data: unknown): unknown {
  const copy = structuredClone(raw);
  for (const query of queriesOf(copy)) if (JSON.stringify(query.queryKey) === JSON.stringify(key)) query.state.data = data;
  return copy;
}

describe("readPersistedClient", () => {
  it("reads back every kept query as the endpoint shaped it", () => {
    const raw = written();
    const read = readPersistedClient(raw);
    expect(read?.dropped).toBe(0);
    expect(read?.client.clientState.queries.map((q) => q.state.data)).toEqual(queriesOf(raw).map((q) => q.state.data));
    expect(read?.client.clientState.mutations).toEqual([]);
  });

  it("drops a query whose data does not read, alone", () => {
    const cases: Array<[readonly unknown[], unknown]> = [
      [["workspaces"], [{ name: "no id" }]],
      [["workspaces"], "drift"],
      [chatKeys.rooms("w1"), { rooms: [] }],
      [chatKeys.unreadSummary(), "drift"],
      [chatKeys.nicknames("w1"), { U1: 1 }],
      [chatKeys.members("w1"), null],
      [chatKeys.roomMembers("w1", "r1"), [{ user_id: "u1" }]],
      [chatKeys.roomMessages("w1", "r1"), { pages: [messages("m1")], pageParams: [] }],
      [chatKeys.roomMessages("w1", "r1"), { pages: [messages("m1")], pageParams: [{ cursor: 1 }] }],
      [chatKeys.roomMessages("w1", "r1"), [messages("m1")]],
    ];
    for (const [key, data] of cases) {
      const read = readPersistedClient(withData(written(), key, data));
      expect(read?.dropped, JSON.stringify([key, data])).toBe(1);
      expect(read?.client.clientState.queries.some((q) => JSON.stringify(q.queryKey) === JSON.stringify(key))).toBe(false);
    }
  });

  it("drops one drifted message or room, not the page or the list", () => {
    const timeline = { pages: [[message("m2"), { id: "broken" }]], pageParams: [null] };
    const read = readPersistedClient(withData(withData(written(), chatKeys.roomMessages("w1", "r1"), timeline), chatKeys.rooms("w1"), [...rooms, { id: "x" }]));
    const data = (key: readonly unknown[]) => read?.client.clientState.queries.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(key))?.state.data;
    expect(data(chatKeys.roomMessages("w1", "r1"))).toEqual({ pages: [messages("m2")], pageParams: [null] });
    expect(data(chatKeys.rooms("w1"))).toEqual(rooms);
  });

  it("forgets a refetch's error and an infinite query's fetch meta, and drops what is not a kept query", () => {
    const raw = written();
    const [first] = queriesOf(raw);
    Object.assign(first!.state, { error: {}, fetchFailureReason: {}, fetchMeta: { fetchMore: { direction: "forward" } }, fetchStatus: "lost" });
    const odd = [
      "not a query",
      { ...first, state: { ...first!.state, status: "error" } },
      { ...first, queryKey: ["remote-config"] },
      { ...first, queryKey: ["chat", "w1", "follow-ups"] },
      { ...first, queryKey: ["chat", "w1", "room-search", "r1"] },
      { ...first, queryKey: ["chat", "unread-summary", "x"] },
    ];
    queriesOf(raw).push(...(odd as never[]));
    const read = readPersistedClient(raw);
    expect(read?.dropped).toBe(odd.length);
    const state = read?.client.clientState.queries[0]?.state;
    expect([state?.error, state?.fetchFailureReason, state?.fetchMeta, state?.fetchStatus]).toEqual([null, null, null, "idle"]);
  });

  it("reads nothing of an envelope that is not a persisted client", () => {
    for (const raw of [undefined, null, "x", { buster: "b", timestamp: "1", clientState: { queries: [] } }, { buster: "b", timestamp: 1 }]) {
      expect(readPersistedClient(raw)).toBeNull();
    }
  });
});

describe("persistedRooms", () => {
  it("reads a kept rooms list, and nothing of anything else", () => {
    expect(persistedRooms(rooms)).toEqual(rooms);
    expect(persistedRooms("drift")).toEqual([]);
    expect(persistedRooms([{ id: "x" }])).toEqual([]);
  });
});

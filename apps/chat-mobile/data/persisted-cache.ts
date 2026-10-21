// The query cache read back from disk (data/query-persister.ts) is untrusted
// input, like a network answer: an older build wrote it, or an OTA changed
// the code that reads it since. Before anything is hydrated, the envelope is
// checked and every kept query's data goes back through the schema that
// shaped it from the network (the same lenient ones chat-api.ts and api.ts
// use), so a list cell never renders a record that was cast from disk. A
// query whose data does not read is dropped alone and refetches as on a first
// launch; the rest of the inbox still opens at once.
//
// The data's shape is checked here; its meaning is CACHE_SCHEMA_VERSION's.
// Bump it when a kept record keeps its shape but changes what it means (a
// field reinterpreted, a list now filtered differently): the buster changes
// and every copy written before is dropped. persisted-schema.lock.json pins
// this file's hash to the version, so editing it is a decision about the
// version, never an accident.
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { ChatMessagesListSchema, ChatRoomsListSchema, ChatUnreadSummarySchema, type ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { z } from "zod";
import { MembersSchema, WorkspaceMembersSchema } from "./chat-api-schemas";
import { WorkspacesResponseSchema } from "./schemas";

export const CACHE_SCHEMA_VERSION = 1;

type Reader = (data: unknown) => { ok: true; data: unknown } | { ok: false };

const ok = (data: unknown) => ({ ok: true as const, data });
const NOT_READ = { ok: false as const };

/** An envelope schema around a bare list: the list as the endpoint returned it, or nothing. */
function listIn<K extends string>(schema: z.ZodType<Partial<Record<K, unknown>>>, field: K): Reader {
  return (data) => {
    if (!Array.isArray(data)) return NOT_READ;
    const parsed = schema.safeParse({ [field]: data });
    return parsed.success ? ok(parsed.data[field]) : NOT_READ;
  };
}

function readWith(schema: z.ZodType): Reader {
  return (data) => {
    const parsed = schema.safeParse(data);
    return parsed.success ? ok(parsed.data) : NOT_READ;
  };
}

// chat-timeline.ts › RoomMessagesPageParam: the newest page, or the cursor of an older one.
const PageParamSchema = z.union([z.null(), z.object({ cursor: z.string().optional(), before: z.string().optional() })]);
const TimelineSchema = z
  .object({ pages: z.array(z.array(z.unknown())), pageParams: z.array(PageParamSchema) })
  .refine((timeline) => timeline.pages.length === timeline.pageParams.length, { message: "a page without its param" });

const readTimeline: Reader = (data) => {
  const parsed = TimelineSchema.safeParse(data);
  if (!parsed.success) return NOT_READ;
  // One drifted message drops alone, as on the network (chat-schemas › lenientMessageList).
  const pages = parsed.data.pages.map((page) => ChatMessagesListSchema.parse({ messages: page }).messages);
  return ok({ pages, pageParams: parsed.data.pageParams });
};

/** The reader of each kept query, by the key's shape (query-persister.ts › shouldPersistQuery decides which are kept). */
function readerFor(queryKey: readonly unknown[]): Reader | null {
  const [root, second, third] = queryKey;
  if (root === "workspaces" && queryKey.length === 1) return listIn(WorkspacesResponseSchema, "workspaces");
  if (root !== "chat") return null;
  if (second === "unread-summary" && queryKey.length === 2) return readWith(ChatUnreadSummarySchema);
  if (queryKey.length === 3) {
    if (third === "rooms") return listIn(ChatRoomsListSchema, "rooms");
    if (third === "nicknames") return readWith(z.record(z.string(), z.string()));
    if (third === "members") return listIn(WorkspaceMembersSchema, "members");
  }
  if (queryKey.length === 4 && third === "room-members") return listIn(MembersSchema, "members");
  if (queryKey.length === 4 && third === "room-messages") return readTimeline;
  return null;
}

// What a hydrate reads of a dehydrated query. An error from a failed refetch
// (status stays "success") does not survive JSON anyway: it reads as none, as
// does the fetch meta of an infinite query; the fetch status is reset by hydrate.
const forgotten = z.unknown().transform(() => null);
const PersistedQuerySchema = z.object({
  queryKey: z.array(z.unknown()),
  queryHash: z.string(),
  state: z.object({
    data: z.unknown(),
    dataUpdateCount: z.number(),
    dataUpdatedAt: z.number(),
    error: forgotten,
    errorUpdateCount: z.number(),
    errorUpdatedAt: z.number(),
    fetchFailureCount: z.number(),
    fetchFailureReason: forgotten,
    fetchMeta: forgotten,
    isInvalidated: z.boolean(),
    status: z.literal("success"),
    fetchStatus: z.enum(["fetching", "paused", "idle"]).catch("idle"),
  }),
});
type PersistedQuery = PersistedClient["clientState"]["queries"][number];

const PersistedClientSchema = z.object({
  timestamp: z.number(),
  buster: z.string(),
  clientState: z.looseObject({ queries: z.array(z.unknown()) }),
});

export interface ReadPersistedClient {
  client: PersistedClient;
  /** Kept queries that did not read and were left out. */
  dropped: number;
}

/** Kept queries read from disk, each re-read through its schema; one that does not read is left out and counted. */
export function readPersistedQueries(candidates: readonly unknown[]): { queries: PersistedQuery[]; dropped: number } {
  let dropped = 0;
  const queries = candidates.flatMap((candidate): PersistedQuery[] => {
    const query = PersistedQuerySchema.safeParse(candidate);
    const read = query.success ? readerFor(query.data.queryKey)?.(query.data.state.data) : undefined;
    if (!query.success || !read?.ok) {
      dropped += 1;
      return [];
    }
    return [{ ...query.data, state: { ...query.data.state, data: read.data } }];
  });
  return { queries, dropped };
}

/** A copy read from disk, every query re-read through its schema; null when the envelope itself does not read. */
export function readPersistedClient(raw: unknown): ReadPersistedClient | null {
  const envelope = PersistedClientSchema.safeParse(raw);
  if (!envelope.success) return null;
  const { queries, dropped } = readPersistedQueries(envelope.data.clientState.queries);
  const { timestamp, buster } = envelope.data;
  // No mutation is ever kept (query-persister.ts › shapePersistedClient).
  return { client: { timestamp, buster, clientState: { mutations: [], queries } }, dropped };
}

/** The rooms of a kept rooms list, read rather than cast (the save path ranks them by activity). */
export function persistedRooms(data: unknown): ChatRoomRecord[] {
  // The list schema drops a drifted row alone; over an array it cannot fail.
  return Array.isArray(data) ? ChatRoomsListSchema.parse({ rooms: data }).rooms : [];
}

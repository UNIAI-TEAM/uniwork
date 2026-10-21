// The server's side of the app's responses (audit "missed": a server change
// never ran the mobile tests). Every field a response schema the app parses
// with declares must be a JSON field of the Go SDO that answers it, nested
// objects included, so a rename or a removal on the server fails here, on the
// server's PR (scripts/mobile-native-scope.mjs lists the SDO folder), instead
// of reading as "missing" through the lenient schema on the phone. The schemas
// stay lenient (ADR 0003): this test is about names, not optionality.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ChatGifListSchema,
  ChatMessageEnvelopeSchema,
  ChatMessageSchema,
  ChatRoomEnvelopeSchema,
  ChatRoomSharedSummarySchema,
  ChatRoomsListSchema,
  ChatUnreadSummarySchema,
  PendingChatVoiceInvitesSchema,
} from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ActiveRecordingSchema,
  FollowUpEnvelopeSchema,
  FollowUpListSchema,
  LinkListSchema,
  MembersSchema,
  OutgoingVoiceCallsSchema,
  TaskEnvelopeSchema,
  ThreadReadSchema,
} from "./chat-api-schemas";

const SDO_DIR = path.resolve(__dirname, "../../../server/internal/handler/dto/sdo");

interface GoField {
  type: string;
}
type GoStructs = Map<string, Map<string, GoField>>;

/** Every struct of the sdo package: its JSON field names and Go types, embedded structs merged in. */
function readStructs(): GoStructs {
  const raw = new Map<string, { fields: Map<string, GoField>; embeds: string[] }>();
  for (const file of readdirSync(SDO_DIR).filter((f) => f.endsWith(".go") && !f.endsWith("_test.go"))) {
    const source = readFileSync(path.join(SDO_DIR, file), "utf8");
    for (const match of source.matchAll(/^type (\w+) struct \{\n([\s\S]*?)^\}/gm)) {
      const fields = new Map<string, GoField>();
      const embeds: string[] = [];
      for (const line of (match[2] ?? "").split("\n")) {
        const field = /^\s*\w+\s+(\S+)\s+`[^`]*json:"([^",]*)/.exec(line);
        if (field?.[2] && field[2] !== "-") fields.set(field[2], { type: field[1] ?? "" });
        const embed = /^\s*\*?(\w+)\s*(?:`.*)?$/.exec(line);
        if (!field && embed?.[1]) embeds.push(embed[1]);
      }
      raw.set(match[1] ?? "", { fields, embeds });
    }
  }
  const resolve = (name: string, seen = new Set<string>()): Map<string, GoField> => {
    const entry = raw.get(name);
    if (!entry || seen.has(name)) return new Map();
    seen.add(name);
    const merged = new Map<string, GoField>();
    for (const embed of entry.embeds) for (const [k, v] of resolve(embed, seen)) merged.set(k, v);
    for (const [k, v] of entry.fields) merged.set(k, v);
    return merged;
  };
  return new Map([...raw.keys()].map((name) => [name, resolve(name)]));
}

/** The struct a Go field type names, if it is one of the package's: `[]*FooDTO` → FooDTO. */
const structOf = (goType: string, structs: GoStructs): string | undefined => {
  const name = goType.replace(/^(\[\]|\*)+/, "");
  return structs.has(name) ? name : undefined;
};

interface ZodDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  element?: z.ZodType;
  in?: z.ZodType;
  options?: z.ZodType[];
}
const defOf = (schema: z.ZodType): ZodDef => (schema as unknown as { _zod: { def: ZodDef } })._zod.def;

/** The object (or array element object) under the lenient wrappers, or undefined for a leaf. */
function objectShape(schema: z.ZodType): Record<string, z.ZodType> | undefined {
  const def = defOf(schema);
  switch (def.type) {
    case "object":
      return def.shape;
    case "array":
      return def.element ? objectShape(def.element) : undefined;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
      return def.innerType ? objectShape(def.innerType) : undefined;
    case "pipe":
      return def.in ? objectShape(def.in) : undefined;
    case "union":
      return def.options?.map(objectShape).find(Boolean);
    default:
      return undefined;
  }
}

/** Each schema field with no JSON field of that name in the struct, as a dotted path. */
function drift(shape: Record<string, z.ZodType>, struct: string, structs: GoStructs, at = ""): string[] {
  const fields = structs.get(struct);
  if (!fields) return [`${at || "(root)"}: no struct ${struct} in the sdo package`];
  return Object.entries(shape).flatMap(([key, value]) => {
    const where = at ? `${at}.${key}` : key;
    const field = fields.get(key);
    if (!field) return [`${where} (${struct} has no json:"${key}")`];
    const inner = objectShape(value);
    const nested = structOf(field.type, structs);
    return inner && nested ? drift(inner, nested, structs, where) : [];
  });
}

// The response the app parses, and the SDO that answers it. A handler that answers with a
// map literal (`map[string]any{"message": …}`) names the struct of each key instead.
const CONTRACTS: { endpoint: string; schema: z.ZodType; sdo: string | Record<string, string> }[] = [
  { endpoint: "GET …/chat/messages/{id}", schema: ChatMessageEnvelopeSchema, sdo: { message: "ChatMessageDTO" } },
  // ChatMessagesListSchema reads `messages` as unknown[] and parses each item with ChatMessageSchema.
  { endpoint: "GET …/chat/rooms/{id}/messages (each item)", schema: ChatMessageSchema, sdo: "ChatMessageDTO" },
  { endpoint: "GET …/chat/rooms/{id}", schema: ChatRoomEnvelopeSchema, sdo: { room: "ChatRoomDTO" } },
  { endpoint: "GET …/chat/rooms, …/chat/channels", schema: ChatRoomsListSchema, sdo: "ChatChannelListSDO" },
  { endpoint: "GET /me/chat/unread-summary", schema: ChatUnreadSummarySchema, sdo: "ChatUnreadSummarySDO" },
  { endpoint: "GET …/chat/rooms/{id}/shared-summary", schema: ChatRoomSharedSummarySchema, sdo: "ChatRoomSharedSummarySDO" },
  { endpoint: "GET …/chat/voice/pending (invites)", schema: PendingChatVoiceInvitesSchema, sdo: "PendingVoiceInvitesSDO" },
  { endpoint: "GET …/chat/voice/pending (outgoing)", schema: OutgoingVoiceCallsSchema, sdo: "PendingVoiceInvitesSDO" },
  { endpoint: "GET …/chat/rooms/{id}/members", schema: MembersSchema, sdo: "ChatRoomMemberListSDO" },
  { endpoint: "POST …/chat/threads/{id}/read", schema: ThreadReadSchema, sdo: "ChatThreadReadSDO" },
  { endpoint: "GET …/chat/follow-ups", schema: FollowUpListSchema, sdo: "ChatFollowUpListSDO" },
  { endpoint: "POST …/chat/follow-ups", schema: FollowUpEnvelopeSchema, sdo: "ChatFollowUpSDO" },
  { endpoint: "GET …/chat/rooms/{id}/message-links", schema: LinkListSchema, sdo: "ChatMessageLinkListSDO" },
  { endpoint: "GET …/chat/gifs|stickers", schema: ChatGifListSchema, sdo: "ChatGifListSDO" },
  { endpoint: "POST …/chat/messages/{id}/task", schema: TaskEnvelopeSchema, sdo: "TaskSDO" },
  { endpoint: "GET …/chat/rooms/{id}/voice/recording/active", schema: ActiveRecordingSchema, sdo: "ChatVoiceRecordingSDO" },
];

describe("the app's response schemas against the server's SDOs", () => {
  const structs = readStructs();

  it("reads the sdo package", () => {
    expect(structs.get("ChatMessageDTO")?.has("client_msg_id")).toBe(true);
    expect(structOf("[]*ChatRoomDTO", structs)).toBe("ChatRoomDTO");
    expect(structOf("map[string]int", structs)).toBeUndefined();
  });

  it.each(CONTRACTS)("$endpoint: every field the app reads is one the server writes", ({ schema, sdo }) => {
    const shape = objectShape(schema);
    expect(shape).toBeDefined();
    const missing =
      typeof sdo === "string"
        ? drift(shape ?? {}, sdo, structs)
        : Object.entries(sdo).flatMap(([key, struct]) => {
            const inner = shape?.[key];
            const innerShape = inner ? objectShape(inner) : undefined;
            return innerShape ? drift(innerShape, struct, structs, key) : [`${key}: not an object in the schema`];
          });
    expect(missing).toEqual([]);
  });

  it("names a drifted field with its path", () => {
    const fake = new Map([
      ["Outer", new Map([["inner", { type: "*Inner" }]])],
      ["Inner", new Map([["id", { type: "string" }]])],
    ]);
    const schema = z.object({ inner: z.object({ id: z.string(), name: z.string().optional() }).nullish(), extra: z.string() });
    expect(drift(objectShape(schema) ?? {}, "Outer", fake)).toEqual(['inner.name (Inner has no json:"name")', 'extra (Outer has no json:"extra")']);
    expect(drift({}, "Nope", fake)).toEqual(["(root): no struct Nope in the sdo package"]);
  });
});

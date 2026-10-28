// The server's side of the app's responses (audit "missed": a server change
// never ran the mobile tests). Every field a response schema the app parses
// with declares must be a JSON field of the Go SDO that answers it, nested
// objects and list items included, so a rename or a removal on the server
// fails here, on the server's PR (scripts/mobile-native-scope.mjs lists the
// SDO folder and the handler files read below), instead of reading as
// "missing" through the lenient schema on the phone. The schemas stay lenient
// (ADR 0003): this test is about names, not optionality.
//
// Each row also names the Go handlers that answer it, and the handler's own
// source must answer with that struct: `respondJSON(w, …, sdo.X{…})`, a
// converter or variable typed `sdo.X`, or a map literal whose top-level keys
// (`{"message": toChatMessageDTO(msg)}`) are each checked, key and struct. So
// a handler-only rename of a wrapper key fails too. Not covered: a handler
// that answers through a path this reader cannot follow fails as unresolved
// rather than passing, and the mobile flags the app reads are held to the
// server's flag catalogue at the end.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ChatGifListSchema,
  ChatMessageEnvelopeSchema,
  ChatMessageSchema,
  ChatMessagesListSchema,
  ChatRoomEnvelopeSchema,
  ChatRoomSchema,
  ChatRoomSharedSummarySchema,
  ChatRoomsListSchema,
  ChatUnreadSummarySchema,
  PendingChatVoiceInvitesSchema,
} from "@uniwork/core/api/endpoints/chat-schemas";
import { AuthProvidersSchema, SignInIdentitySchema, SignInMethodsSchema, StepUpGrantSchema } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { InvitationPreviewSchema, PendingInvitationSchema } from "@uniwork/core/types/workspace";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ERASED_ACCOUNT_NAME } from "@/lib/erased-account";
import { MobileSecurityPolicySchema, PushPreviewPolicySchema } from "./account-api";
import { AcceptedSchema, OrganizationsSchema } from "./invitations/api";
import { OrgMemberRowSchema, OrgMembersPageSchema } from "./queries/org-members";
import { ChatSyncSchema } from "./chat-sync/api";
import {
  ActiveRecordingSchema,
  FollowUpEnvelopeSchema,
  FollowUpListSchema,
  LinkListSchema,
  MembersSchema,
  OutgoingVoiceCallsSchema,
  TaskEnvelopeSchema,
  ThreadReadSchema,
  WorkspaceMemberSchema,
  WorkspaceMembersSchema,
} from "./chat-api-schemas";
import { MOBILE_FLAG_DEFAULTS, RemoteConfigSchema } from "./remote-config";
import { MeResponseSchema, WorkspacesResponseSchema } from "./schemas";

// remote-config.ts and account-api.ts reach the transport (React Native) at import; only their schemas are read here.
vi.mock("./api", () => ({ api: {} }));

const SERVER = path.resolve(__dirname, "../../../server/internal");
const SDO_DIR = path.join(SERVER, "handler/dto/sdo");
// The handler files the rows' handlers live in; each pattern is in scripts/mobile-native-scope.mjs › MOBILE_PATHS,
// so a change to one runs this test (checked below).
const HANDLER_FILES = [
  "chat*.go",
  "auth.go",
  "identity.go",
  "config.go",
  "push_preview_policy.go",
  "workspace.go",
  "task.go",
  "organization_members.go",
  // GET /orgs: what the empty workspace picker says when no invitation waits.
  "organization.go",
  // GET /me/invitations: the invitations the empty workspace picker answers.
  "onboarding.go",
  // Unified sign-in (ADR 0049): the app's doors, Settings › Sign-in methods and step-up, /auth/providers.
  "native_sign_in.go",
  "sign_in_methods.go",
  "sign_in_ticket.go",
  "verification.go",
];
// Structs of other packages an SDO embeds as a field: ConfigSDO.unichat_stores is a config.UniChatStoreLinks.
const FOREIGN_STRUCTS: Record<string, string> = { config: "config/unichat_downloads.go" };

interface GoField {
  type: string;
}
type GoStructs = Map<string, Map<string, GoField>>;

const goFiles = (dir: string, patterns = ["*.go"]): string[] => {
  const res = patterns.map((p) => new RegExp(`^${p.replace(/[.]/g, "\\.").replace("*", "[^/]*")}$`));
  return readdirSync(dir)
    .filter((f) => f.endsWith(".go") && !f.endsWith("_test.go") && res.some((re) => re.test(f)))
    .map((f) => path.join(dir, f));
};

/**
 * Every struct of the sdo package (and the FOREIGN_STRUCTS files, as `pkg.Name`): its JSON field names and Go
 * types, embedded structs merged in.
 */
function readStructs(): GoStructs {
  const sources = [
    ...goFiles(SDO_DIR).map((file) => ({ file, prefix: "" })),
    ...Object.entries(FOREIGN_STRUCTS).map(([pkg, file]) => ({ file: path.join(SERVER, file), prefix: `${pkg}.` })),
  ];
  const raw = new Map<string, { fields: Map<string, GoField>; embeds: string[] }>();
  for (const { file, prefix } of sources) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^type (\w+) struct \{\n([\s\S]*?)^\}/gm)) {
      const fields = new Map<string, GoField>();
      const embeds: string[] = [];
      for (const line of (match[2] ?? "").split("\n")) {
        const field = /^\s*\w+\s+(\S+)\s+`[^`]*json:"([^",]*)/.exec(line);
        if (field?.[2] && field[2] !== "-") fields.set(field[2], { type: field[1] ?? "" });
        const embed = /^\s*\*?(\w+)\s*(?:`.*)?$/.exec(line);
        if (!field && embed?.[1]) embeds.push(embed[1]);
      }
      raw.set(`${prefix}${match[1] ?? ""}`, { fields, embeds });
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

/** Whether an answer's struct (or each map-literal key's struct) is the one a row names. */
type Answer = { struct: string | undefined } | { keys: Record<string, string | undefined> } | { unresolved: string };

const funcPattern = (name: string) => `^func (?:\\(h \\*handlers\\) )?${name}\\(`;

/** A function's source, from its `func` line to its closing brace at column 0. */
function funcBody(source: string, name: string): string | undefined {
  const start = new RegExp(funcPattern(name), "m").exec(source);
  if (!start) return undefined;
  const end = source.indexOf("\n}\n", start.index);
  return source.slice(start.index, end < 0 ? undefined : end + 2);
}

/** The sdo struct a function returns, first result: `) sdo.X {`, `) ([]sdo.X, error) {`. */
function returnStruct(source: string, name: string): string | undefined {
  return new RegExp(`${funcPattern(name)}[^\\n]*?\\) \\(?(?:\\[\\])?\\*?sdo\\.(\\w+)`, "m").exec(source)?.[1];
}

/** The sdo struct a Go expression evaluates to, in the body of the function it is written in. */
function valueStruct(source: string, body: string, expression: string): string | undefined {
  const expr = expression.trim();
  const literal = /^&?sdo\.(\w+)\{/.exec(expr);
  if (literal) return literal[1];
  const call = /^(?:h\.)?(\w+)\(/.exec(expr);
  if (call?.[1]) return returnStruct(source, call[1]);
  const ident = /^(\w+)(?:\[\d+\])?$/.exec(expr)?.[1];
  if (!ident) return undefined;
  const declared =
    new RegExp(`\\b${ident} :?= &?sdo\\.(\\w+)\\{`).exec(body)?.[1] ??
    new RegExp(`\\b${ident} :?= make\\(\\[\\]\\*?sdo\\.(\\w+)`).exec(body)?.[1] ??
    new RegExp(`\\bvar ${ident} (?:\\[\\])?\\*?sdo\\.(\\w+)`).exec(body)?.[1];
  if (declared) return declared;
  const assigned = new RegExp(`\\b${ident}(?:, \\w+)? :?= (?:h\\.)?(\\w+)\\(`).exec(body)?.[1];
  return assigned ? returnStruct(source, assigned) : undefined;
}

/** What a handler answers 2xx with: its last `respondJSON`, or the `h.respond…` / `h.…Answer` helper it hands it to. */
function answerOf(source: string, handler: string, seen = new Set<string>()): Answer {
  const body = funcBody(source, handler);
  if (!body || seen.has(handler)) return { unresolved: `no func ${handler}` };
  seen.add(handler);
  const responses = [...body.matchAll(/respondJSON\(w, [^,]+, (.*)$/gm)];
  const last = responses.at(-1)?.[1];
  if (last === undefined) {
    const helper = /\bh\.(respond\w+|\w+Answer)\(/.exec(body)?.[1];
    return helper ? answerOf(source, helper, seen) : { unresolved: `${handler} has no respondJSON` };
  }
  const map = /^map\[string\]any\{(.*)\}\)\s*$/.exec(last);
  if (map) {
    const keys = Object.fromEntries([...(map[1] ?? "").matchAll(/"(\w+)": ([^,}]+)/g)].map((m) => [m[1] ?? "", valueStruct(source, body, m[2] ?? "")]));
    return { keys };
  }
  return { struct: valueStruct(source, body, last.replace(/\)\s*$/, "")) };
}

/** The struct a row says its handlers answer with, in the shape answerOf reports it. */
const expected = (sdo: string | Record<string, string>): Answer => (typeof sdo === "string" ? { struct: sdo } : { keys: sdo });

interface Contract {
  endpoint: string;
  /** The schema the app parses the answer with. */
  schema: z.ZodType;
  /** The struct that answers, or for a handler answering with a map literal, the struct under each key. */
  sdo: string | Record<string, string>;
  /** The handler methods (server/internal/handler) that answer it. */
  handlers: string[];
  /**
   * Lists parsed one item at a time (`z.array(z.unknown()).transform(…)`), whose items a schema walk cannot
   * see: the item schema under each such key, compared with that key's struct.
   */
  items?: Record<string, z.ZodType>;
}

// Unified sign-in (ADR 0049): what the app reads around the schemas core exports. Core keeps the envelopes of
// readNativeSignIn and readSignInMethodsChange module-private, so their keys are written out here with core's own
// schemas nested; the session is what data/auth/transport.ts › parseSession reads, strictly, of DesktopSessionSDO.
const SessionFields = z.object({
  account_id: z.string(),
  device_session_id: z.string(),
  session_id: z.string(),
  deployment_id: z.string(),
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  refresh_expires_in: z.number(),
});
const NativeSignInFields = z.object({
  status: z.string(),
  session: SessionFields,
  reclaimed: z.boolean(),
  link_skipped: z.string(),
  mfa_token: z.string(),
  ticket: z.string(),
  identity: SignInIdentitySchema,
});
const SignInMethodsChangeFields = z.object({ user: z.unknown(), sign_in_methods: SignInMethodsSchema });
const SentFields = z.object({ status: z.string() });

const CONTRACTS: Contract[] = [
  // Sign-in (ADR 0049 §8): the app's doors, the providers it offers, Settings › Sign-in methods and step-up.
  {
    endpoint: "POST /auth/native/{password,mfa,google,apple,register}, …/sign-in-ticket/{create,claim-email/verify}",
    schema: NativeSignInFields,
    sdo: "NativeSignInSDO",
    handlers: ["nativePassword", "nativeMFA", "nativeGoogle", "nativeApple", "nativeRegister", "nativeTicketCreate", "nativeTicketClaimEmailVerify"],
  },
  { endpoint: "POST /auth/native/sign-in-ticket/claim-email, /me/step-up/email-code", schema: SentFields, sdo: "StatusSDO", handlers: ["nativeTicketClaimEmail", "stepUpEmailCode"] },
  { endpoint: "GET /auth/providers", schema: AuthProvidersSchema, sdo: "AuthProvidersSDO", handlers: ["authProviders"] },
  { endpoint: "GET /me/sign-in-methods", schema: SignInMethodsSchema, sdo: "SignInMethodsSDO", handlers: ["signInMethods"] },
  {
    endpoint: "PUT /me/password, POST /me/sign-in-methods/{p}/{native,unlink}, /auth/native/sign-in-ticket/link",
    schema: SignInMethodsChangeFields,
    sdo: "SignInMethodsChangeSDO",
    handlers: ["setPassword", "signInMethodUnlink", "signInMethodLinkNative", "nativeTicketLink"],
  },
  { endpoint: "POST /me/step-up", schema: StepUpGrantSchema, sdo: "StepUpSDO", handlers: ["stepUp"] },
  // Boot, account and remote config: the shell, Settings and the kill switches (mobile_flags).
  { endpoint: "GET|PATCH /me, PUT|DELETE /me/ai-consent, PUT /me/push-previews", schema: MeResponseSchema, sdo: { user: "UserDTO" }, handlers: ["me", "patchMe", "answerAIConsent", "setPushPreviews", "verifyEmail"] },
  { endpoint: "GET /workspaces", schema: WorkspacesResponseSchema, sdo: "WorkspaceListSDO", handlers: ["listWorkspaces"] },
  { endpoint: "GET /workspaces/{id}/members", schema: WorkspaceMembersSchema, sdo: "MemberListSDO", handlers: ["listMembers"], items: { members: WorkspaceMemberSchema } },
  { endpoint: "GET /config", schema: RemoteConfigSchema, sdo: "ConfigSDO", handlers: ["config"] },
  { endpoint: "GET /orgs/{org}/push-preview-policy", schema: PushPreviewPolicySchema, sdo: "PushPreviewPolicySDO", handlers: ["orgPushPreviewPolicy"] },
  {
    endpoint: "GET /orgs/{org}/mobile-security-policy",
    schema: MobileSecurityPolicySchema,
    sdo: "MobileSecurityPolicySDO",
    handlers: ["orgMobileSecurityPolicy"],
  },
  // The empty workspace picker (spec §5.2): an invitation's preview, where joining it led, and whether the account
  // already belongs to an organization. GET /me/invitations answers rows built as map literals, not an SDO, so only
  // core's schema reads them (its malformed case is data/invitations/api.test.ts).
  { endpoint: "GET /invitations/{token}", schema: InvitationPreviewSchema, sdo: "InvitationPreviewSDO", handlers: ["previewInvitation"] },
  { endpoint: "POST /invitations/{token}/accept", schema: AcceptedSchema, sdo: "AcceptInviteSDO", handlers: ["acceptInvitation"] },
  { endpoint: "GET /orgs", schema: OrganizationsSchema, sdo: { organizations: "OrganizationDTO" }, handlers: ["listOrganizations"] },
  // Who an owner deleting the account can hand the organization to, and whom the contacts tab leaves out.
  {
    endpoint: "GET /orgs/{org}/members",
    schema: OrgMembersPageSchema,
    sdo: "OrgMemberListSDO",
    handlers: ["listOrgMembers"],
    items: { members: OrgMemberRowSchema },
  },
  // Chat.
  {
    endpoint: "GET|POST …/chat/rooms/{id}/messages/{id}, reactions, edit, pin, thread reply",
    schema: ChatMessageEnvelopeSchema,
    sdo: { message: "ChatMessageDTO" },
    handlers: ["getChatRoomMessage", "sendChatRoomMessage", "toggleChatMessageReaction", "editChatMessage", "toggleChatMessagePin", "sendChatThreadMessage"],
  },
  {
    endpoint: "GET …/chat/rooms/{id}/messages, …/around, …/search, …/threads/{id}/messages",
    schema: ChatMessagesListSchema,
    sdo: { messages: "ChatMessageDTO" },
    handlers: ["listChatRoomMessages", "listChatRoomMessagesAround", "searchChatRoomMessages", "listChatThreadMessages"],
    items: { messages: ChatMessageSchema },
  },
  {
    endpoint: "GET …/chat/rooms/{id}, POST …/chat/dm, …/chat/groups, …/members, …/channels/{id}/join",
    schema: ChatRoomEnvelopeSchema,
    sdo: { room: "ChatRoomDTO" },
    handlers: ["getChatRoomDetail", "resolveDM", "createChatGroup", "inviteChatGroupMembers", "joinChatChannel"],
  },
  { endpoint: "GET …/chat/rooms", schema: ChatRoomsListSchema, sdo: { rooms: "ChatRoomDTO" }, handlers: ["listChatRooms"], items: { rooms: ChatRoomSchema } },
  { endpoint: "GET …/chat/channels", schema: ChatRoomsListSchema, sdo: "ChatChannelListSDO", handlers: ["listChatChannels"], items: { rooms: ChatRoomSchema } },
  { endpoint: "GET /me/chat/unread-summary", schema: ChatUnreadSummarySchema, sdo: "ChatUnreadSummarySDO", handlers: ["chatUnreadSummary"] },
  { endpoint: "GET …/chat/rooms/{id}/shared-summary", schema: ChatRoomSharedSummarySchema, sdo: "ChatRoomSharedSummarySDO", handlers: ["getChatRoomSharedSummary"] },
  { endpoint: "GET …/chat/voice/pending (invites)", schema: PendingChatVoiceInvitesSchema, sdo: "PendingVoiceInvitesSDO", handlers: ["listPendingChatVoiceInvites"] },
  { endpoint: "GET …/chat/voice/pending (outgoing)", schema: OutgoingVoiceCallsSchema, sdo: "PendingVoiceInvitesSDO", handlers: ["listPendingChatVoiceInvites"] },
  { endpoint: "GET …/chat/rooms/{id}/members", schema: MembersSchema, sdo: "ChatRoomMemberListSDO", handlers: ["listChatRoomMembers"] },
  { endpoint: "POST …/chat/threads/{id}/read", schema: ThreadReadSchema, sdo: "ChatThreadReadSDO", handlers: ["markChatThreadRead"] },
  { endpoint: "GET …/chat/sync", schema: ChatSyncSchema, sdo: "ChatSyncSDO", handlers: ["getChatSync"] },
  { endpoint: "GET …/chat/follow-ups", schema: FollowUpListSchema, sdo: "ChatFollowUpListSDO", handlers: ["listChatFollowUps"] },
  { endpoint: "POST|PATCH …/chat/follow-ups", schema: FollowUpEnvelopeSchema, sdo: "ChatFollowUpSDO", handlers: ["createChatFollowUp", "patchChatFollowUp"] },
  { endpoint: "GET …/chat/rooms/{id}/message-links", schema: LinkListSchema, sdo: "ChatMessageLinkListSDO", handlers: ["listChatRoomMessageLinks"] },
  { endpoint: "GET …/chat/gifs|stickers", schema: ChatGifListSchema, sdo: "ChatGifListSDO", handlers: ["searchChatGifs", "trendingChatGifs", "searchChatStickers", "trendingChatStickers"] },
  { endpoint: "POST …/chat/follow-ups/{id}/task", schema: TaskEnvelopeSchema, sdo: { task: "TaskDTO" }, handlers: ["convertChatFollowUpToTask"] },
  { endpoint: "GET …/chat/rooms/{id}/voice/recording/active", schema: ActiveRecordingSchema, sdo: "ChatVoiceRecordingSDO", handlers: ["getActiveChatVoiceRecording"] },
];

/** Every schema field (and listed item field) the row's struct does not write, as dotted paths. */
function rowDrift({ schema, sdo, items = {} }: Contract, structs: GoStructs): string[] {
  const shape = objectShape(schema) ?? {};
  const structOfKey = (key: string): string | undefined => {
    if (typeof sdo !== "string") return sdo[key];
    const field = structs.get(sdo)?.get(key);
    return field ? structOf(field.type, structs) : undefined;
  };
  const top =
    typeof sdo === "string"
      ? drift(shape, sdo, structs)
      : Object.entries(sdo).flatMap(([key, struct]) => {
          const inner = shape[key];
          if (!inner) return [`${key}: not a field of the schema`];
          const innerShape = objectShape(items[key] ?? inner);
          return innerShape ? drift(innerShape, struct, structs, key) : [`${key}: not an object in the schema`];
        });
  const listed =
    typeof sdo === "string"
      ? Object.entries(items).flatMap(([key, item]) => {
          const struct = structOfKey(key);
          if (!struct) return [`${key}: ${sdo} has no struct-typed json:"${key}"`];
          return drift(objectShape(item) ?? {}, struct, structs, `${key}[]`);
        })
      : [];
  return [...top, ...listed];
}

describe("the app's response schemas against the server's SDOs and handlers", () => {
  const structs = readStructs();
  const handlers = goFiles(path.join(SERVER, "handler"), HANDLER_FILES)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  it("reads the sdo package, the foreign structs and the handlers", () => {
    expect(structs.get("ChatMessageDTO")?.has("client_msg_id")).toBe(true);
    expect(structs.get("config.UniChatStoreLinks")?.has("play_internal")).toBe(true);
    expect(structOf("[]*ChatRoomDTO", structs)).toBe("ChatRoomDTO");
    expect(structOf("config.UniChatStoreLinks", structs)).toBe("config.UniChatStoreLinks");
    expect(structOf("map[string]int", structs)).toBeUndefined();
    expect(funcBody(handlers, "listChatRooms")).toMatch(/^func \(h \*handlers\) listChatRooms\(/);
  });

  it.each(CONTRACTS)("$endpoint: every field the app reads is one the server writes", (row) => {
    expect(objectShape(row.schema)).toBeDefined();
    expect(rowDrift(row, structs)).toEqual([]);
  });

  it.each(CONTRACTS.flatMap((row) => row.handlers.map((handler) => ({ handler, sdo: row.sdo, endpoint: row.endpoint }))))(
    "$handler answers $endpoint with the struct the row compares",
    ({ handler, sdo }) => {
      expect(answerOf(handlers, handler)).toEqual(expected(sdo));
    },
  );

  // GET /me/invitations builds each row as a map literal (onboarding.go › myInvitations), which answerOf cannot
  // follow into: every key core's PendingInvitationSchema reads is held to a key of that literal (and of the literals
  // nested in it) here, and its workspaces to the struct toInvitationWorkspaceDTOs returns.
  it("GET /me/invitations: every field the app reads is a key the server's rows write", () => {
    const body = funcBody(handlers, "myInvitations") ?? "";
    expect(answerOf(handlers, "myInvitations")).toEqual({ keys: { invitations: undefined } });
    const written = new Set([...body.matchAll(/"(\w+)":|row\["(\w+)"\] =/g)].map((m) => m[1] ?? m[2] ?? ""));
    const nestedKeys = (key: string): string[] => {
      const literal = new RegExp(`(?:"${key}":|row\\["${key}"\\] =)\\s*map\\[string\\]string\\{([^}]*)\\}`).exec(body)?.[1] ?? "";
      return [...literal.matchAll(/"(\w+)":/g)].map((m) => m[1] ?? "");
    };
    const missing = Object.entries(objectShape(PendingInvitationSchema) ?? {}).flatMap(([key, value]) => {
      if (!written.has(key)) return [`${key} (no "${key}" key in myInvitations' row)`];
      const inner = objectShape(value) ?? {};
      if (key === "workspaces") {
        if (!/"workspaces": toInvitationWorkspaceDTOs\(/.test(body)) return ["workspaces: no longer toInvitationWorkspaceDTOs"];
        return drift(inner, returnStruct(handlers, "toInvitationWorkspaceDTOs") ?? "", structs, key);
      }
      return Object.keys(inner)
        .filter((sub) => !nestedKeys(key).includes(sub))
        .map((sub) => `${key}.${sub}`);
    });
    expect(missing).toEqual([]);
  });

  // The calls kill switch (owner decision): a key the app reads that the server's catalogue does not
  // declare as a mobile flag never arrives, so the server could not switch it off.
  it("every mobile flag the app reads is a mobile flag of the server's catalogue", () => {
    const keys = readFileSync(path.join(SERVER, "featureflags/keys.go"), "utf8");
    for (const [flag, value] of Object.entries(MOBILE_FLAG_DEFAULTS)) {
      expect(keys).toMatch(new RegExp(`\\{Key: "${flag}",[^\\n]*\\bMobile: true\\b`));
      // Before (or without) an answer the app acts on the same value the server would send.
      expect(keys).toMatch(new RegExp(`\\{Key: "${flag}",[^\\n]*\\bDefault: ${value},`));
    }
  });

  // The app reads an erased account's name in its own language by matching the server's word for it.
  it("knows the name the server gives an erased account", () => {
    const deletion = readFileSync(path.join(SERVER, "service/account_deletion.go"), "utf8");
    expect(deletion).toContain(`const deletedDisplayName = "${ERASED_ACCOUNT_NAME}"`);
  });

  it("runs on every server change it reads (scripts/mobile-native-scope.mjs › MOBILE_PATHS)", () => {
    const scope = readFileSync(path.resolve(__dirname, "../../../scripts/mobile-native-scope.mjs"), "utf8");
    const read = [
      "server/internal/handler/dto/sdo/**",
      ...HANDLER_FILES.map((f) => `server/internal/handler/${f}`),
      ...Object.values(FOREIGN_STRUCTS).map((f) => `server/internal/${f}`),
      "server/internal/featureflags/keys.go",
      "server/internal/service/account_deletion.go",
    ];
    for (const glob of read) expect(scope).toContain(`"${glob}"`);
  });

  it("names a drifted field with its path", () => {
    const fake = new Map([
      ["Outer", new Map([["inner", { type: "*Inner" }], ["list", { type: "[]Inner" }]])],
      ["Inner", new Map([["id", { type: "string" }]])],
    ]);
    const schema = z.object({ inner: z.object({ id: z.string(), name: z.string().optional() }).nullish(), extra: z.string() });
    expect(drift(objectShape(schema) ?? {}, "Outer", fake)).toEqual(['inner.name (Inner has no json:"name")', 'extra (Outer has no json:"extra")']);
    expect(drift({}, "Nope", fake)).toEqual(["(root): no struct Nope in the sdo package"]);
    // A transform list's items, which the schema walk alone treats as a leaf.
    const list = z.object({ list: z.array(z.unknown()).transform((x) => x) });
    const item = z.object({ id: z.string(), gone: z.string() });
    expect(rowDrift({ endpoint: "", schema: list, sdo: "Outer", handlers: [], items: { list: item } }, fake)).toEqual(['list[].gone (Inner has no json:"gone")']);
    expect(rowDrift({ endpoint: "", schema: list, sdo: { list: "Inner" }, handlers: [], items: { list: item } }, fake)).toEqual(['list.gone (Inner has no json:"gone")']);
  });

  it("reads a handler's answer: a struct, a converter, a variable, a helper, or a map literal's keys", () => {
    const go = [
      "func toThingDTO(t service.Thing) sdo.ThingDTO {\n\treturn sdo.ThingDTO{}\n}\n",
      "func (h *handlers) lister(r *http.Request) ([]sdo.ThingDTO, error) {\n\treturn nil, nil\n}\n",
      "func (h *handlers) one(w http.ResponseWriter, r *http.Request) {\n\trespondJSON(w, http.StatusOK, map[string]any{\"thing\": toThingDTO(t)})\n}\n",
      "func (h *handlers) many(w http.ResponseWriter, r *http.Request) {\n\tout := make([]sdo.ThingDTO, 0)\n\trespondJSON(w, http.StatusOK, map[string]any{\"things\": out, \"next\": cursor})\n}\n",
      "func (h *handlers) wrapped(w http.ResponseWriter, r *http.Request) {\n\trespondJSON(w, 200, sdo.ThingSDO{\n\t\tThing: x,\n\t})\n}\n",
      "func (h *handlers) built(w http.ResponseWriter, r *http.Request) {\n\tout := sdo.ThingSDO{}\n\trespondJSON(w, http.StatusOK, out)\n}\n",
      "func (h *handlers) delegated(w http.ResponseWriter, r *http.Request) {\n\th.respondThing(w, r)\n}\n",
      "func (h *handlers) respondThing(w http.ResponseWriter, r *http.Request) {\n\tdtos, err := h.lister(r)\n\trespondJSON(w, 201, map[string]any{\"thing\": dtos[0]})\n}\n",
      "func (h *handlers) silent(w http.ResponseWriter, r *http.Request) {\n\tw.WriteHeader(204)\n}\n",
    ].join("\n");
    expect(answerOf(go, "one")).toEqual({ keys: { thing: "ThingDTO" } });
    // A renamed key or an untyped value shows up as a different answer.
    expect(answerOf(go, "many")).toEqual({ keys: { things: "ThingDTO", next: undefined } });
    expect(answerOf(go, "wrapped")).toEqual({ struct: "ThingSDO" });
    expect(answerOf(go, "built")).toEqual({ struct: "ThingSDO" });
    expect(answerOf(go, "delegated")).toEqual({ keys: { thing: "ThingDTO" } });
    expect(answerOf(go, "silent")).toEqual({ unresolved: "silent has no respondJSON" });
    expect(answerOf(go, "missing")).toEqual({ unresolved: "no func missing" });
  });
});

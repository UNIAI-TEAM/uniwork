// The realtime frames the phone acts on, one zod decoder each (audit P2
// Kiến trúc: payloads were cast, never checked). ws-client.ts decodes every
// frame before any handler sees it: a frame of a type listed here whose
// payload does not match is dropped with a breadcrumb, so a drifted server
// can make the phone miss an update (the next reconnect refetches) but never
// patch a cache or ring a call from a wrong shape. A type not listed (an
// event this build predates, a frame for a screen the phone does not have)
// passes through untouched: nothing here reacts to it.
//
// The keys are the catalogue's (docs/events/CATALOGUE.md; every value a
// string). A key a handler needs is required; one it can do without is
// optional, but present with the wrong type it still drops the frame.
// Objects are loose: a key added to the catalogue later reaches handlers.
import { z } from "zod";
import { createLogger } from "../logger";
import type { WSMessage } from "./ws-types";

const log = createLogger("realtime");

const id = z.string().min(1);
const opt = z.string().optional();
const frame = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);

const messageFrame = frame({ room_id: id, message_id: id, sender_id: opt, thread_root_id: opt });
const roomFrame = frame({ room_id: opt });
const roomMemberFrame = frame({ room_id: opt, user_id: opt });
const channelFrame = frame({ room_id: opt, workspace_id: opt });
const followUpFrame = frame({ follow_up_id: opt, room_id: opt, message_id: opt });
const userFrame = frame({ user_id: id });
const voiceSignalFrame = frame({ room_id: id, call_id: id, user_id: id, target_user_id: opt });
const workspaceFrame = frame({ workspace_id: opt, organization_id: opt });

export const FRAME_SCHEMAS = {
  // Transport frames (server/internal/realtime/hub.go) for the scoped subscriptions.
  subscribe_ack: frame({ scope: z.string(), id: z.string() }),
  subscribe_error: frame({ scope: z.string(), id: z.string(), error: opt }),
  "chat.message.created": messageFrame,
  "chat.message.updated": frame({ room_id: id, message_id: id }),
  "chat.message.deleted": frame({ room_id: id, message_id: id }),
  "chat.thread.replied": frame({ room_id: id, message_id: id, thread_root_id: id }),
  "chat.mention.created": frame({ room_id: id, message_id: opt, sender_id: opt, thread_root_id: opt }),
  "chat.room.activity": roomFrame,
  "chat.room.created": roomFrame,
  "chat.room.updated": roomFrame,
  "chat.room.members_added": roomFrame,
  "chat.room.member_added": roomMemberFrame,
  "chat.room.member_removed": roomMemberFrame,
  "chat.room.read": frame({ room_id: id, user_id: id }),
  "chat.channel.created": channelFrame,
  "chat.channel.updated": channelFrame,
  "chat.channel.archived": channelFrame,
  "chat.follow_up.created": followUpFrame,
  "chat.follow_up.updated": followUpFrame,
  "chat.follow_up.completed": followUpFrame,
  "chat.follow_up.deleted": followUpFrame,
  "chat.typing": frame({ room_id: id, user_id: id }),
  "user.presence": userFrame,
  "user.offline": userFrame,
  // Call signalling (the call engine, data/calls/call-engine.ts): ids only; the names come with GET …/voice/pending.
  "chat.voice.invite": frame({ room_id: id, call_id: id, caller_id: id, target_user_id: opt }),
  "chat.voice.accept": voiceSignalFrame,
  "chat.voice.hangup": voiceSignalFrame,
  "workspace.created": workspaceFrame,
  "workspace.updated": workspaceFrame,
} as const;

export type KnownFrameType = keyof typeof FRAME_SCHEMAS;
export type FramePayload<T extends KnownFrameType> = z.infer<(typeof FRAME_SCHEMAS)[T]>;

interface Actor {
  actor_id?: string;
  actor_type?: string;
}

/** A decoded frame of a listed type: its payload is the decoder's output. */
export type KnownFrame = { [K in KnownFrameType]: { type: K; payload: FramePayload<K> } & Actor }[KnownFrameType];

/** What onAny hands on: a decoded frame, or one of a type the phone does not act on (its payload unread). */
export type RealtimeFrame = KnownFrame | WSMessage;

export function isKnownFrameType(type: string): type is KnownFrameType {
  return Object.prototype.hasOwnProperty.call(FRAME_SCHEMAS, type);
}

/**
 * Narrows a frame from onAny to a decoded one. Sound because ws-client hands
 * on a listed type only after decodeFrame accepted it.
 */
export function isKnownFrame(frame: RealtimeFrame): frame is KnownFrame {
  return isKnownFrameType(frame.type);
}

/** The frame with a decoded payload, the frame untouched when its type is not listed, or null to drop it. */
export function decodeFrame(msg: WSMessage): RealtimeFrame | null {
  if (!isKnownFrameType(msg.type)) return msg;
  const parsed = FRAME_SCHEMAS[msg.type].safeParse(msg.payload);
  if (!parsed.success) {
    // The event name and the failing keys only: a value may be chat text or an id.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(payload)"))].join(",");
    log.warn("malformed frame dropped", { type: msg.type, fields });
    return null;
  }
  return { ...msg, payload: parsed.data } as KnownFrame;
}

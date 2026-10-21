// The call pushes the server sends a phone (server notification/push_expo.go
// › callData; docs/adr/drafts/0038): a ring ("call_invite"), its end
// ("call_end") and a missed DM call ("call_missed"). Android gets the ring and
// its end as data-only messages that reach the app's background task
// (data/calls/background.ts) and become its own ringing notification; an
// iPhone gets the ring as a visible push. Every value arrives as a string and
// is read leniently: an unknown type or a missing id is not a call push.
import type { VoiceCallKind } from "./voice-call";

export type CallPush =
  | {
      type: "call_invite";
      callId: string;
      roomId: string;
      workspaceId: string;
      callerName: string;
      roomName: string;
      callKind: VoiceCallKind;
      video: boolean;
      /** Unix milliseconds the ring stops; 0 when the push did not say. */
      expiresAt: number;
      /** The web link of the call (`/{org}/{ws}/chat?room=&call=`), the ringing screen's route. */
      url: string;
    }
  | { type: "call_end"; callId: string; roomId: string; workspaceId: string }
  | { type: "call_missed"; callId: string; roomId: string; workspaceId: string; url: string };

/** How long a ring may last when its push says nothing (the server's callRingWindow). */
export const CALL_RING_WINDOW_MS = 60_000;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function callKind(value: unknown): VoiceCallKind {
  return value === "group" || value === "channel" ? value : "dm";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

/** The call push in a push's data (the parsed `data` of a notification), or null when it is none. */
export function callPushFromData(value: unknown): CallPush | null {
  const data = record(value);
  if (!data) return null;
  const callId = text(data.call_id);
  const roomId = text(data.room_id);
  if (!callId || !roomId) return null;
  const workspaceId = text(data.workspace_id);
  switch (data.type) {
    case "call_invite": {
      const expiresAt = Number(text(data.expires_at));
      return {
        type: "call_invite",
        callId,
        roomId,
        workspaceId,
        callerName: text(data.caller_name),
        roomName: text(data.room_name),
        callKind: callKind(data.call_kind),
        video: data.video === "1",
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
        url: text(data.url),
      };
    }
    case "call_end":
      return { type: "call_end", callId, roomId, workspaceId };
    case "call_missed":
      return { type: "call_missed", callId, roomId, workspaceId, url: text(data.url) };
    default:
      return null;
  }
}

/** How deep taskPayloadData looks for the FCM data map. */
const PAYLOAD_DEPTH = 3;

/**
 * The data of a background notification task's payload. On Android the FCM
 * message's data map carries Expo's JSON of what the server sent under
 * `body` (`dataString` in expo-notifications' serialization); the map sits
 * at the top of the payload or under `data` / `notification`, a level or two
 * down, depending on the path that ran the task (a live app, the job that
 * restarts a killed one). A map that already is the data is taken as it is.
 */
export function taskPayloadData(payload: unknown): Record<string, unknown> | null {
  let level = [record(payload)];
  for (let depth = 0; depth < PAYLOAD_DEPTH; depth++) {
    const next: (Record<string, unknown> | null)[] = [];
    for (const candidate of level) {
      if (!candidate) continue;
      const parsed = parseJson(candidate.dataString) ?? parseJson(candidate.body);
      if (parsed) return parsed;
      if (typeof candidate.type === "string" && typeof candidate.call_id === "string") return candidate;
      next.push(record(candidate.data), record(candidate.notification));
    }
    level = next;
  }
  return null;
}

/** How much longer a ring may last, at most the ring window; 0 once it is over. */
export function ringRemainingMs(push: Extract<CallPush, { type: "call_invite" }>, now: number): number {
  if (!push.expiresAt) return CALL_RING_WINDOW_MS;
  return Math.max(0, Math.min(CALL_RING_WINDOW_MS, push.expiresAt - now));
}

/** The call's web link with or without `answer=1` (lib/deep-link.ts reads it). */
export function callLink(url: string, answer: boolean): string {
  try {
    const target = new URL(url);
    if (answer) target.searchParams.set("answer", "1");
    else target.searchParams.delete("answer");
    return target.toString();
  } catch {
    return url;
  }
}

/** The custom-scheme wrapper every build opens, verified app links or not (lib/deep-link.ts › parseDeepLink). */
export function appLink(scheme: string, webUrl: string): string {
  return `${scheme}://open?url=${encodeURIComponent(webUrl)}`;
}

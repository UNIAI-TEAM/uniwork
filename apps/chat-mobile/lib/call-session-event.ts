// What the system's call UI tells the app (docs/adr/0038): the events of the iOS half of modules/unichat-calls
// (ios/CallCenter.swift, "onCallEvent") read without trusting their shape, and the link an answered call opens.
// A drifted or unknown event reads as null and is dropped: the system's call UI is not a source the app can type.
import { appLink } from "./call-push";
import { isRecord } from "./unknown-shape";

/** The call a VoIP push reported to the system, as the server's payload named it. */
export interface SessionCall {
  callId: string;
  roomId: string;
  workspaceId: string;
  orgSlug: string;
  wsSlug: string;
  /** "" when the server left the name out (the lock-screen preview rule). */
  callerName: string;
  video: boolean;
}

export type CallSessionEvent =
  /** PushKit handed over a new VoIP token ("" when it took the old one back). */
  | { type: "token"; token: string }
  /** The system's own Answer, Decline, or End of a call under way. */
  | { type: "answered" | "declined" | "ended"; call: SessionCall }
  | { type: "muted"; callId: string; muted: boolean }
  /** Another call (the phone's own) took the line (`held`) or gave it back. */
  | { type: "held"; callId: string; held: boolean }
  /** The system activated (or released) the call's audio session. */
  | { type: "audio"; active: boolean };

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function sessionCall(event: Record<string, unknown>): SessionCall | null {
  const callId = text(event.callId);
  if (!callId) return null;
  return {
    callId,
    roomId: text(event.roomId),
    workspaceId: text(event.workspaceId),
    orgSlug: text(event.orgSlug),
    wsSlug: text(event.wsSlug),
    callerName: text(event.callerName),
    video: event.video === true,
  };
}

export function callSessionEventFrom(value: unknown): CallSessionEvent | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "token":
      return typeof value.token === "string" ? { type: "token", token: value.token } : null;
    case "answered":
    case "declined":
    case "ended": {
      const call = sessionCall(value);
      return call ? { type: value.type, call } : null;
    }
    case "muted":
      return text(value.callId) && typeof value.muted === "boolean" ? { type: "muted", callId: text(value.callId), muted: value.muted } : null;
    case "held":
      return typeof value.held === "boolean" ? { type: "held", callId: text(value.callId), held: value.held } : null;
    case "audio":
      return typeof value.active === "boolean" ? { type: "audio", active: value.active } : null;
    default:
      return null;
  }
}

/**
 * The link an answered call opens: the call's room on the Chat tab with `call=`, which rings it there and, vouched
 * for by the system's answer (NativeCallSession.takeAnswered), answers it (components/chat/use-deep-link-target.ts).
 * Null when the push did not name the workspace or the room: nothing to open.
 */
export function answeredCallLink(scheme: string, call: SessionCall): string | null {
  if (!call.orgSlug || !call.wsSlug || !call.roomId) return null;
  const query = new URLSearchParams({ room: call.roomId, call: call.callId });
  return appLink(scheme, `/${encodeURIComponent(call.orgSlug)}/${encodeURIComponent(call.wsSlug)}/chat?${query.toString()}`);
}

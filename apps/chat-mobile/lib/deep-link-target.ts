// What the Chat tab does with the params a deep link lands it on
// (lib/deep-link.ts › deepLinkHref writes them): `room` (+ `message`) opens a
// room, `dm` opens or creates the DM, `room` + `call` is a ringing call's push
// (its ringing screen, or with `answer=1` — the notification's Answer button —
// the call itself), and with the server's calls switch off the call's room.
// Pure: components/chat/use-deep-link-target.ts carries the plan out.

export interface DeepLinkParams {
  room?: string;
  message?: string;
  dm?: string;
  call?: string;
  answer?: string;
}

export type DeepLinkPlan =
  | { kind: "none" }
  | { kind: "room"; roomId: string; messageId?: string }
  | { kind: "dm"; userId: string }
  | { kind: "ring"; roomId: string; callId: string }
  | { kind: "answer"; roomId: string; callId: string }
  /** The calls switch is off: the ringing notification goes, the room opens where the call is logged. */
  | { kind: "calls-off"; roomId: string; callId: string };

/** One string per link, so the same params are carried out once; empty when the tab has none. */
export function deepLinkKey(params: DeepLinkParams): string {
  const key = [params.room, params.message, params.dm, params.call, params.answer].map((value) => value ?? "").join("|");
  return key === "||||" ? "" : key;
}

export function planDeepLink(params: DeepLinkParams, callsOn: boolean): DeepLinkPlan {
  const { room, message, dm, call, answer } = params;
  if (room && call) {
    if (!callsOn) return { kind: "calls-off", roomId: room, callId: call };
    return { kind: answer === "1" ? "answer" : "ring", roomId: room, callId: call };
  }
  if (room) return message ? { kind: "room", roomId: room, messageId: message } : { kind: "room", roomId: room };
  if (dm) return { kind: "dm", userId: dm };
  return { kind: "none" };
}

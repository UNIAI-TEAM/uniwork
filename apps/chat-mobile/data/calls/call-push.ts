// What a call push does on the phone (docs/adr/drafts/0038). On Android it
// arrives data-only, through the background notification task
// (data/calls/call-wiring.ts), whether UniChat is closed, in the background or
// on screen. A ring becomes the app's own incoming-call notification —
// full-screen on a locked phone, Answer and Decline, the ringtone on the
// "calls" channel — unless the call already rings in the app's call screen;
// the end of a ring and a missed call take that notification down. The calls
// switch (data/remote-config.ts) off means no ring.
import { CALL_RING_WINDOW_MS, appLink, callLink, ringRemainingMs, type CallPush } from "@/lib/call-push";
import type { VoiceCallState } from "@/lib/voice-call";
import type { NativeCalls, NativeIncomingCall } from "./native-calls";

type Invite = Extract<CallPush, { type: "call_invite" }>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface CallPushEnv {
  native: Pick<NativeCalls, "showIncomingCall" | "cancelIncomingCall">;
  /** UniChat is on screen; false in a headless task. */
  appActive: () => boolean;
  /** The calls switch: the last answer the app holds, else its default (on). */
  callsOn: () => boolean;
  engine: {
    current(): VoiceCallState;
    contextWorkspaceId(): string | null;
    syncPendingInvites(): Promise<void>;
  };
  /** Creates the notification channels in the app's language before the first ring. */
  ensureChannels: () => void;
  t: Translate;
  /** The app's URL scheme, which every build opens (app.config.ts › scheme). */
  scheme: string;
  now: () => number;
}

export type CallPushOutcome = "shown" | "in_app" | "ignored" | "cleared";

function liveCallId(state: VoiceCallState): string | null {
  return state.status === "idle" || state.status === "ended" ? null : state.callId;
}

/** The incoming-call notification for a ring: who, what kind of call, and where Answer and a tap lead. */
export function incomingCallSpec(push: Invite, env: Pick<CallPushEnv, "t" | "scheme" | "now">): NativeIncomingCall {
  const text =
    push.callKind === "dm"
      ? env.t(push.video ? "mobile.call_notify.incoming_video" : "mobile.call_notify.incoming_voice")
      : env.t("mobile.call_notify.incoming_group", { room: push.roomName || env.t("mobile.call_notify.group_fallback") });
  return {
    callId: push.callId,
    roomId: push.roomId,
    workspaceId: push.workspaceId,
    callerName: push.callerName || env.t("mobile.call_notify.unknown_caller"),
    callKind: push.callKind,
    text,
    video: push.video,
    openUrl: appLink(env.scheme, callLink(push.url, false)),
    answerUrl: appLink(env.scheme, callLink(push.url, true)),
    timeoutMs: ringRemainingMs(push, env.now()),
    answerLabel: env.t("chat.voice_call_accept"),
    declineLabel: env.t("chat.voice_call_decline"),
  };
}

/**
 * The same notification for a call the app is ringing on screen when the
 * person leaves the app (Home, another app): the call screen is gone from
 * view, so the ring moves to the notification (answer, decline, full screen
 * once locked). `chatUrl` is the open workspace's web chat URL.
 */
export function incomingSpecFromState(
  state: Extract<VoiceCallState, { status: "incoming" }>,
  chatUrl: string,
  workspaceId: string,
  env: Pick<CallPushEnv, "t" | "scheme" | "now">,
): NativeIncomingCall {
  const group = state.callKind !== "dm";
  const url = `${chatUrl}?room=${encodeURIComponent(state.roomId)}&call=${encodeURIComponent(state.callId)}`;
  return incomingCallSpec(
    {
      type: "call_invite",
      callId: state.callId,
      roomId: state.roomId,
      workspaceId,
      callerName: group ? (state.callerName ?? "") : state.peerName,
      roomName: group ? state.peerName : "",
      callKind: state.callKind,
      video: false,
      expiresAt: env.now() + CALL_RING_WINDOW_MS,
      url,
    },
    env,
  );
}

export async function handleCallPush(push: CallPush, env: CallPushEnv): Promise<CallPushOutcome> {
  if (push.type !== "call_invite") {
    // Answered elsewhere, declined, ended, or missed: the ring stops here too.
    env.native.cancelIncomingCall(push.callId);
    return "cleared";
  }
  if (!env.callsOn() || !push.url || ringRemainingMs(push, env.now()) <= 0) return "ignored";
  const live = liveCallId(env.engine.current());
  // The call screen already has it; or another call is under way, which says "busy" through the engine.
  if (live) return live === push.callId ? "in_app" : "ignored";
  if (env.appActive() && env.engine.contextWorkspaceId()) {
    // On screen in a workspace: its socket rings a call there, and the pending
    // list picks one up the socket missed. A call it does not know (another
    // workspace) rings as the notification, heads-up over the app (audit C3).
    await env.engine.syncPendingInvites().catch(() => undefined);
    if (liveCallId(env.engine.current()) === push.callId) return "in_app";
  }
  env.ensureChannels();
  return env.native.showIncomingCall(incomingCallSpec(push, env)) ? "shown" : "ignored";
}

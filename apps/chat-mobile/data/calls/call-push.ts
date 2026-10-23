// What a call push does on the phone (docs/adr/drafts/0038). On Android it
// arrives data-only, through the background notification task
// (data/calls/call-wiring.ts), whether UniChat is closed, in the background or
// on screen. A ring becomes the app's own incoming-call notification —
// full-screen on a locked phone, Answer and Decline, the ringtone on the
// "calls" channel — unless the call already rings in the app's call screen;
// the end of a ring and a missed call take that notification down. A ring the
// native notification could not show falls back to a plain one. The calls
// switch (data/remote-config.ts) off means no ring.
import { CALL_RING_WINDOW_MS, appLink, ringRemainingMs, type CallPush } from "@/lib/call-push";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import type { NativeCalls, NativeIncomingCall } from "./native-calls";
import { bestEffort } from "../report";

type Invite = Extract<CallPush, { type: "call_invite" }>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface CallPushEnv {
  native: Pick<NativeCalls, "showIncomingCall" | "cancelIncomingCall">;
  /**
   * A plain notification for a ring the native one did not show (a build
   * without the module, a post the system refused): a tap opens `url`, the
   * call's ringing screen. Rejects when it cannot be posted either.
   */
  fallback: { show(call: NativeIncomingCall, url: string): Promise<void>; dismiss(callId: string): Promise<void> };
  /** UniChat is on screen; false in a headless task. */
  appActive: () => boolean;
  /** The calls switch: the last answer the app holds, else its default (on). */
  callsOn: () => boolean;
  engine: {
    current(): VoiceCallOverlayState;
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

/**
 * What a push did, counted per build (data/analytics.ts › call_push; server alert UniChatCallRingsDegraded): the
 * native ring shown, the plain fallback, rung in the app already, ignored (switch off, over, busy), an end that
 * cleared a ring, or a ring lost — no notification of either kind could be posted.
 */
export type CallPushOutcome = "shown" | "fallback" | "in_app" | "ignored" | "cleared" | "lost";

function liveCallId(state: VoiceCallOverlayState): string | null {
  return state.status === "idle" || state.status === "ended" ? null : state.callId;
}

/** The incoming-call notification for a ring: who, what kind of call, and where a tap (and Answer) leads. */
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
    // Answer opens this same link: what makes it answer is a token only the notification's own
    // PendingIntent carries (modules/unichat-calls › CallLaunchTokens), never something in the URL.
    openUrl: appLink(env.scheme, push.url),
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
  state: Extract<VoiceCallOverlayState, { status: "incoming" }>,
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
    await env.fallback.dismiss(push.callId).catch(bestEffort("call-push", "fallback ring not dismissed", "breadcrumb"));
    return "cleared";
  }
  if (!env.callsOn() || !push.url || ringRemainingMs(push, env.now()) <= 0) return "ignored";
  const live = liveCallId(env.engine.current());
  // The call screen already has it; or another call is under way, which says "busy" through the engine.
  if (live) return live === push.callId ? "in_app" : "ignored";
  if (env.appActive() && env.engine.contextWorkspaceId()) {
    // On screen in a workspace: its socket rings a call there, and the pending
    // list picks one up the socket missed. A call it does not know (another
    // workspace) rings as the notification, heads-up over the app.
    await env.engine.syncPendingInvites().catch(bestEffort("call-push", "pending calls not read", "report"));
    if (liveCallId(env.engine.current()) === push.callId) return "in_app";
  }
  env.ensureChannels();
  const spec = incomingCallSpec(push, env);
  if (env.native.showIncomingCall(spec)) return "shown";
  // A data-only ring is never dropped without a trace: no ringtone loop or
  // full screen, but the person sees who is calling and a tap opens the call.
  return env.fallback.show(spec, push.url).then(
    () => "fallback" as const,
    () => "lost" as const,
  );
}

// Decline and Hang up tapped on the phone's own call notifications
// (modules/unichat-calls › CallActionReceiver). The ringing has already
// stopped natively; this tells the call engine, or — when the app was not
// running the call — the server. Only a 1-1 call is declined on the server:
// a group or channel call goes on without the person, as the call screen's
// own Decline does (call-engine.ts › leavingSignalsHangup). A tap older than
// a ring window is dropped: the call ended on its own by then.
import { CALL_RING_WINDOW_MS } from "@/lib/call-push";
import type { VoiceCallState } from "@/lib/voice-call";
import type { NativeCallAction } from "./native-calls";

export interface CallActionEnv {
  engine: { current(): VoiceCallState; hangUp(): Promise<void> };
  /** Signs the stored session in if needed and declines the call on the server. */
  declineOnServer(workspaceId: string, roomId: string, callId: string): Promise<void>;
  now: () => number;
}

export type CallActionOutcome = "engine" | "server" | "ignored";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The action in a headless task's data or a pending entry, or null when it is none. */
export function callActionFrom(value: unknown): NativeCallAction | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const action = text(data.action);
  const callId = text(data.callId);
  if ((action !== "decline" && action !== "hangup") || !callId) return null;
  return {
    action,
    callId,
    roomId: text(data.roomId),
    workspaceId: text(data.workspaceId),
    callKind: text(data.callKind),
    at: typeof data.at === "number" && Number.isFinite(data.at) ? data.at : 0,
  };
}

export async function handleCallAction(action: NativeCallAction, env: CallActionEnv): Promise<CallActionOutcome> {
  const state = env.engine.current();
  if (state.status !== "idle" && state.status !== "ended" && state.callId === action.callId) {
    await env.engine.hangUp();
    return "engine";
  }
  if (action.action !== "decline" || action.callKind !== "dm" || !action.workspaceId || !action.roomId) return "ignored";
  if (env.now() - action.at > CALL_RING_WINDOW_MS) return "ignored";
  await env.declineOnServer(action.workspaceId, action.roomId, action.callId);
  return "server";
}

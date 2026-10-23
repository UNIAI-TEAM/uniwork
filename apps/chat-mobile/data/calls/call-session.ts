// The system's call UI's own buttons, carried out by the app (docs/adr/0038). On iOS a VoIP push rings through
// CallKit with no JavaScript running; what the person does there arrives here as a NativeCallSession event:
//
// - answered: the call's room opens with `call=` (the same link a ringing push opens), and the Chat tab answers it
//   because the system vouches for the answer (NativeCallSession.takeAnswered, components/chat/use-deep-link-target.ts);
//   the call screen then joins LiveKit. On a locked phone this runs in the background behind CallKit's own screen.
// - declined, ended: the Decline the Android notification's button runs (call-actions.ts): the engine hangs up a call
//   it holds; otherwise the server hears the decline, so the caller stops ringing. An End on a call the app never
//   joined is a decline too.
// - audio: CallKit activated (or released) the call's audio session; WebRTC is told, as LiveKit asks of a CallKit app.
//
// The engine's own answer, decline and end go the other way (call-session-sync.ts). Events from before the app
// listened (a closed app launched by the push) are taken once the app does.
import { RTCAudioSession } from "@livekit/react-native-webrtc";
import { answeredCallLink, type CallSessionEvent, type SessionCall } from "@/lib/call-session-event";
import { authConfig } from "../auth/flow";
import { createLogger } from "../logger";
import { installCallSessionSync } from "./call-session-sync";
import { callEngine } from "./call-store";
import { runCallActionTask } from "./call-wiring";
import { nativeCallSession, type NativeCallSession } from "./native-call-session";

const log = createLogger("calls");

interface CallSessionEnv {
  session: Pick<NativeCallSession, "subscribe" | "takePending">;
  scheme: string;
  /** Opens an app link as a notification tap does (app/_layout.tsx › openUrl): kept until sign-in when signed out. */
  openUrl(url: string): void;
  /** The headless Decline / Hang up task's body (call-wiring.ts › runCallActionTask). */
  runAction(data: unknown): Promise<void>;
  audio: { activate(): void; deactivate(): void };
  now(): number;
}

function decline(call: SessionCall, env: CallSessionEnv): void {
  void env.runAction({ action: "decline", callId: call.callId, roomId: call.roomId, workspaceId: call.workspaceId, callKind: "", at: env.now() });
}

export function handleSessionEvent(event: CallSessionEvent, env: CallSessionEnv): void {
  switch (event.type) {
    case "answered": {
      const url = answeredCallLink(env.scheme, event.call);
      if (url) env.openUrl(url);
      else log.warn("answered call names no room");
      return;
    }
    case "declined":
    case "ended":
      decline(event.call, env);
      return;
    case "audio":
      if (event.active) env.audio.activate();
      else env.audio.deactivate();
      return;
    default:
      // token: VoIP registration's (voip-registration.ts); muted, held: the call screen's (components/calls/).
      return;
  }
}

/** Listens first, then takes what came before, so nothing falls between the two; returns the unsubscribe. */
export function startCallSession(env: CallSessionEnv): () => void {
  const off = env.session.subscribe((event) => handleSessionEvent(event, env));
  for (const event of env.session.takePending()) handleSessionEvent(event, env);
  return off;
}

/**
 * At the app's start (app/_layout.tsx), before any other listener of the module's events: the engine ↔ system sync
 * and the system's buttons. `openUrl` is the root layout's. The function it returns undoes both (tests).
 */
export function startNativeCallSession(openUrl: (url: string) => void): () => void {
  const stopSync = installCallSessionSync(callEngine.store, nativeCallSession);
  const stopEvents = startCallSession({
    session: nativeCallSession,
    scheme: authConfig.scheme,
    openUrl,
    runAction: runCallActionTask,
    audio: { activate: () => RTCAudioSession.audioSessionDidActivate(), deactivate: () => RTCAudioSession.audioSessionDidDeactivate() },
    now: () => Date.now(),
  });
  return () => {
    stopSync();
    stopEvents();
  };
}

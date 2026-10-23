// The system's call UI as one interface on both platforms (docs/adr/0038): what the app tells it about a call
// (answered, declined, ended here) and what it tells the app (the person's answer, decline or end on the system's
// own screens, mute, hold, the call's audio). Each half of modules/unichat-calls implements it:
//
// - iOS (ios/CallCenter.swift): CallKit. The incoming call itself is never the app's to report: every VoIP push
//   rings natively before JavaScript runs (iOS ends an app that does not), so `incoming` has no counterpart here.
// - Android (the Kotlin module, through data/calls/native-calls.ts, unchanged): the call notification. Its Decline
//   and Hang up reach the app through the headless task (call-actions.ts), since no JavaScript may be running when
//   they are tapped, so the session's events carry only the phone's own call holding the line.
// - Neither (Expo Go, tests): nothing rings, nothing is told.
import { UniChatCallKit, type UniChatCallKitModule } from "@/modules/unichat-calls";
import { callSessionEventFrom, type CallSessionEvent } from "@/lib/call-session-event";
import { bestEffort } from "../report";
import { nativeCalls, type NativeCalls } from "./native-calls";

export interface NativeCallSession {
  readonly platform: "android" | "ios" | "none";
  /** The system's call UI rings a call nobody has answered yet: the app's own ringer stays quiet. */
  ringing(): boolean;
  /** The person answered this call in the app: the system's UI takes it as answered (and, on iOS, its audio). */
  answered(callId: string): void;
  /** The person declined it in the app: the system's ring goes. */
  declined(callId: string): void;
  /** The call is over for this phone (hung up here or by the others, rung out): the system's UI lets it go. */
  ended(callId: string): void;
  /** Another call (the phone's own) holds the line now. */
  isHeld(): boolean;
  /** True once when the system's own Answer answered this call (no link can claim it); taking it clears it. */
  takeAnswered(callId: string): boolean;
  /** Events from before the app listened (a closed app launched to ring); taking clears them. */
  takePending(): CallSessionEvent[];
  subscribe(listener: (event: CallSessionEvent) => void): () => void;
}

const NO_SESSION: NativeCallSession = {
  platform: "none",
  ringing: () => false,
  answered: () => undefined,
  declined: () => undefined,
  ended: () => undefined,
  isHeld: () => false,
  takeAnswered: () => false,
  takePending: () => [],
  subscribe: () => () => undefined,
};

/** Android: the call notification goes once the app answers, declines or ends the call. */
function androidCallSession(native: NativeCalls): NativeCallSession {
  const dismiss = (callId: string) => native.cancelIncomingCall(callId);
  return {
    platform: "android",
    // The in-app ringer is the module's own (components/calls/use-call-ringtone.ts); no system screen rings over it.
    ringing: () => false,
    answered: dismiss,
    declined: dismiss,
    ended: dismiss,
    isHeld: () => native.isCallHeld(),
    takeAnswered: (callId) => native.takeAnsweredCall(callId),
    // Decline and Hang up wait in the module's own list (takePendingActions), run by data/calls/call-wiring.ts.
    takePending: () => [],
    subscribe: (listener) => native.onCallHeld((held) => listener({ type: "held", callId: "", held })),
  };
}

const parsed = (values: unknown[]): CallSessionEvent[] =>
  values.map(callSessionEventFrom).filter((event): event is CallSessionEvent => event !== null);

/** iOS: CallKit through the module; a call it never heard of (one that rang only in the app) is left alone there. */
function iosCallSession(module: UniChatCallKitModule): NativeCallSession {
  const end = (callId: string) => void module.end(callId).catch(bestEffort("calls", "CallKit call not ended", "breadcrumb"));
  return {
    platform: "ios",
    ringing: () => module.isRinging(),
    answered: (callId) => void module.answer(callId).catch(bestEffort("calls", "CallKit call not answered", "breadcrumb")),
    declined: end,
    ended: end,
    isHeld: () => module.isHeld(),
    takeAnswered: (callId) => module.takeAnswered(callId),
    takePending: () => parsed(module.takePendingEvents()),
    subscribe: (listener) => {
      const sub = module.addListener("onCallEvent", (value) => {
        const event = callSessionEventFrom(value);
        if (event) listener(event);
      });
      return () => sub.remove();
    },
  };
}

export function nativeCallSessionFrom(callKit: UniChatCallKitModule | null, native: NativeCalls): NativeCallSession {
  if (callKit) return iosCallSession(callKit);
  return native.available ? androidCallSession(native) : NO_SESSION;
}

export const nativeCallSession: NativeCallSession = nativeCallSessionFrom(UniChatCallKit, nativeCalls);

/** What VoIP registration needs (data/calls/voip-registration.ts): null where there is no PushKit (Android, a build
 *  without calls, Expo Go). */
export interface VoipPushSource {
  token(): string | null;
  environment(): string;
  bundleId(): string;
  /** A new token ("" when PushKit took it back); returns the unsubscribe. */
  onToken(listener: (token: string) => void): () => void;
}

export function voipPushFrom(callKit: UniChatCallKitModule | null): VoipPushSource | null {
  if (!callKit?.isEnabled()) return null;
  return {
    token: () => callKit.voipToken() || null,
    environment: () => callKit.apnsEnvironment(),
    bundleId: () => callKit.bundleId(),
    onToken: (listener) => {
      const sub = callKit.addListener("onCallEvent", (value) => {
        const event = callSessionEventFrom(value);
        if (event?.type === "token") listener(event.token);
      });
      return () => sub.remove();
    },
  };
}

export const voipPush: VoipPushSource | null = voipPushFrom(UniChatCallKit);

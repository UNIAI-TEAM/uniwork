// UniChat's native calls on Android (docs/adr/drafts/0038; Kotlin under
// android/): the incoming-call notification (CallStyle, full-screen on a
// locked phone, the ringtone on the "calls" channel), the in-call foreground
// service, the in-app ringer on the ringtone stream, and Decline / Hang up
// handed to the "UniChatCallAction" JavaScript task. Null on iOS, in Expo Go
// and in tests: data/calls/native-calls.ts turns every call into a no-op then.
import { requireOptionalNativeModule } from "expo";

export interface CallChannelNames {
  calls: string;
  callsDescription: string;
  ongoing: string;
  ongoingDescription: string;
}

export interface NativeIncomingCall {
  callId: string;
  roomId: string;
  workspaceId: string;
  callerName: string;
  /** dm, group or channel: Decline tells the server only for a DM. */
  callKind: string;
  text: string;
  video: boolean;
  /**
   * The app link a tap, the full-screen intent and Answer open: the ringing screen. Answer adds a token of its
   * own to its PendingIntent (CallLaunchTokens.kt), so only that button answers; the link itself never does.
   */
  openUrl: string;
  timeoutMs: number;
  answerLabel: string;
  declineLabel: string;
}

export interface NativeOngoingCall {
  callId: string;
  roomId: string;
  workspaceId: string;
  peerName: string;
  text: string;
  video: boolean;
  /** Unix milliseconds the call connected; 0 while connecting. */
  startedAt: number;
}

/** A Decline or Hang up tapped on a notification whose JavaScript task could not start then. */
export interface NativeCallAction {
  action: string;
  callId: string;
  roomId: string;
  workspaceId: string;
  /** dm, group or channel ("" for Hang up) */
  callKind: string;
  /** Unix milliseconds of the tap */
  at: number;
}

export interface UniChatCallsModule {
  ensureChannels(names: CallChannelNames): void;
  showIncomingCall(call: NativeIncomingCall): boolean;
  cancelIncomingCall(callId: string): void;
  startOngoingCall(call: NativeOngoingCall): boolean;
  stopOngoingCall(): void;
  startRinging(): void;
  stopRinging(): void;
  canUseFullScreenIntent(): boolean;
  openFullScreenIntentSettings(): void;
  releaseLockScreen(): void;
  /** Holds (true) or releases (false) the proximity wake lock: the screen goes off at the ear (CallProximity.kt). */
  setProximityScreenOff(on: boolean): void;
  takePendingActions(): NativeCallAction[];
  /**
   * True once when this call's notification Answer button opened the app (its PendingIntent's token checked,
   * so no link or other app can forge it), false otherwise. Taking it clears it.
   */
  takeAnsweredCall(callId: string): boolean;
}

export const UniChatCalls = requireOptionalNativeModule<UniChatCallsModule>("UniChatCalls");

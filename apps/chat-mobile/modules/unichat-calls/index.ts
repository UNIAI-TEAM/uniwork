// UniChat's native calls on Android (docs/adr/drafts/0038; Kotlin under
// android/): the incoming-call notification (CallStyle, full-screen on a
// locked phone, the ringtone on the "calls" channel), the in-call foreground
// service, the in-app ringer on the ringtone stream, and Decline / Hang up
// handed to the "UniChatCallAction" JavaScript task; a call push rung
// natively before JavaScript starts (UniChatMessagingService), and whether
// the phone lets a call reach a closed app. Null on iOS, in Expo Go
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

/**
 * What a call push needs to ring with no JavaScript running (RingConfig.kt, kept on the phone): rings at all
 * (the calls switch), the app's link scheme and the notification's words in the app's language.
 */
export interface NativeRingConfig {
  enabled: boolean;
  scheme: string;
  incomingVoice: string;
  incomingVideo: string;
  /** With "{room}" where the room's name goes. */
  incomingGroup: string;
  groupFallback: string;
  unknownCaller: string;
  answerLabel: string;
  declineLabel: string;
}

/** What the native call-push path did while JavaScript was not running (RingReports.kt). */
export interface NativeRingReport {
  /** native (rang), ignored (switch off, signed out, late), cleared (an end took a ring down) */
  result: string;
  /** From the server's ring to the notification, -1 when unknown. */
  latencyMs: number;
}

/** Whether a call reaches this phone while UniChat is closed (BackgroundDelivery.kt). */
export interface NativeBackgroundDelivery {
  /** Android's battery optimization applies to UniChat. */
  batteryOptimized: boolean;
  /** The person (or Android) restricted UniChat's background work (API 28+). */
  backgroundRestricted: boolean;
  /** The vendor whose autostart switch can block it (xiaomi, oppo, vivo, huawei, oneplus, asus), "" for none. */
  autostartBrand: string;
  manufacturer: string;
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
  /**
   * Before the call screen gives way to the rest of the app (shrinking a call): true when the app is not held over a
   * locked phone (never was, or already unlocked), or once the person unlocks it now (Android asks for the PIN); false
   * when they cancel, and the call screen stays (CallLockScreen.leave).
   */
  leaveLockScreen(): Promise<boolean>;
  /** Holds (true) or releases (false) the proximity wake lock: the screen goes off at the ear (CallProximity.kt). */
  setProximityScreenOff(on: boolean): void;
  takePendingActions(): NativeCallAction[];
  /**
   * True once when this call's notification Answer button opened the app (its PendingIntent's token checked,
   * so no link or other app can forge it), false otherwise. Taking it clears it.
   */
  takeAnsweredCall(callId: string): boolean;
  /** The phone's own (cellular) call has the line now, so the call is held (CallInterruptions.kt; Android 12+). */
  isCallHeld(): boolean;
  /** Keeps what a call push needs to ring natively (NativeCallPush.kt), written on every change. */
  configureRing(config: NativeRingConfig): void;
  /**
   * The call engine holds a call (incoming, ringing, connecting or active): a call push then goes to JavaScript,
   * which answers it busy, instead of ringing natively (NativeCallPush.kt › CallEngineLive). Kept in memory, so a
   * process that died forgets it with the engine.
   */
  setCallEngineLive(live: boolean): void;
  /** What the native call-push path did since the last take; taking clears it. */
  takeRingReports(): NativeRingReport[];
  backgroundDelivery(): NativeBackgroundDelivery;
  /** The system page that lets UniChat run in the background; false when none opened. */
  openBatterySettings(): boolean;
  /** The vendor's autostart screen, else the app's settings page; false when none opened. */
  openAutostartSettings(): boolean;
  /** `onCallHeld` fires when the phone's own call takes the line (`held: true`) or gives it back. */
  addListener(eventName: "onCallHeld", listener: (event: { held: boolean }) => void): { remove(): void };
}

export const UniChatCalls = requireOptionalNativeModule<UniChatCallsModule>("UniChatCalls");

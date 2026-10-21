// The native call support (modules/unichat-calls) as the rest of the app uses
// it: the module where it exists (an Android build), a set of no-ops
// everywhere else (iOS, Expo Go, tests), so no caller branches on the
// platform. `available` says which, for the few places that pick another
// path without it (the in-app ringtone).
import { UniChatCalls, type NativeCallAction, type UniChatCallsModule } from "@/modules/unichat-calls";

export type { CallChannelNames, NativeCallAction, NativeIncomingCall, NativeOngoingCall } from "@/modules/unichat-calls";

export type NativeCalls = UniChatCallsModule & { available: boolean };

const NONE: UniChatCallsModule = {
  ensureChannels: () => undefined,
  showIncomingCall: () => false,
  cancelIncomingCall: () => undefined,
  startOngoingCall: () => false,
  stopOngoingCall: () => undefined,
  startRinging: () => undefined,
  stopRinging: () => undefined,
  canUseFullScreenIntent: () => true,
  openFullScreenIntentSettings: () => undefined,
  releaseLockScreen: () => undefined,
  takePendingActions: (): NativeCallAction[] => [],
};

/** Each call goes to the module itself: a native module's functions expect it as `this`. */
export function nativeCallsFrom(module: UniChatCallsModule | null): NativeCalls {
  if (!module) return { ...NONE, available: false };
  return {
    available: true,
    ensureChannels: (names) => module.ensureChannels(names),
    showIncomingCall: (call) => module.showIncomingCall(call),
    cancelIncomingCall: (callId) => module.cancelIncomingCall(callId),
    startOngoingCall: (call) => module.startOngoingCall(call),
    stopOngoingCall: () => module.stopOngoingCall(),
    startRinging: () => module.startRinging(),
    stopRinging: () => module.stopRinging(),
    canUseFullScreenIntent: () => module.canUseFullScreenIntent(),
    openFullScreenIntentSettings: () => module.openFullScreenIntentSettings(),
    releaseLockScreen: () => module.releaseLockScreen(),
    takePendingActions: () => module.takePendingActions(),
  };
}

export const nativeCalls: NativeCalls = nativeCallsFrom(UniChatCalls);

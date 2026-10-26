// Group and channel calls are multi-party; a 1-1 call is "dm". Pure, shared
// by the web and the phone (ADR 0011).
import type { VoiceCallKind } from "./voice-call-types";

export function isMultiPartyVoiceCall(kind: VoiceCallKind | string | undefined): boolean {
  return kind === "group" || kind === "channel";
}

export function voiceCallKindFromServer(callKind?: string): VoiceCallKind {
  if (callKind === "channel") return "channel";
  if (callKind === "group") return "group";
  return "dm";
}

/** Primary hang-up must signal the server so voice_call_log is written (UNI-951). */
export function voiceCallPrimaryLeaveEndsForAll(callKind: VoiceCallKind, isCaller: boolean): boolean {
  if (callKind === "dm") return true;
  return isMultiPartyVoiceCall(callKind) && isCaller;
}

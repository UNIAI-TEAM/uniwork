import type { VoiceCallKind } from "./voice-call-overlay-types";

export function isMultiPartyVoiceCall(kind: VoiceCallKind | string | undefined): boolean {
  return kind === "group" || kind === "channel";
}

export function voiceCallKindFromServer(callKind?: string): VoiceCallKind {
  if (callKind === "channel") return "channel";
  if (callKind === "group") return "group";
  return "dm";
}

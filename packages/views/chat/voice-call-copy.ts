import { ApiError } from "@uniwork/core/api/http";
import type { useTranslation } from "react-i18next";
import { chatErrorMessage } from "./chat-error-message";
import type { VoiceCallDeviceError, VoiceCallEndedState } from "./voice-call-overlay-types";

type TFunction = ReturnType<typeof useTranslation>["t"];

const DEVICE_KEYS = {
  audioinput: {
    denied: "chat.voice_call_device_mic_denied",
    in_use: "chat.voice_call_device_mic_in_use",
    missing: "chat.voice_call_device_mic_missing",
    other: "chat.voice_call_device_mic_other",
  },
  videoinput: {
    denied: "chat.voice_call_device_camera_denied",
    in_use: "chat.voice_call_device_camera_in_use",
    missing: "chat.voice_call_device_camera_missing",
    other: "chat.voice_call_device_camera_other",
  },
} as const;

/** "The browser is blocking the microphone." — which device and why, never just "permission". */
export function voiceCallDeviceMessage(device: VoiceCallDeviceError, t: TFunction): string {
  return t(DEVICE_KEYS[device.kind][device.failure]);
}

/** The server's refusal, in chat's own words (never its raw message). */
function voiceCallErrorMessage(err: unknown, t: TFunction, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code === "livekit_not_configured") return t("chat.voice_call_not_configured");
    if (err.code === "chat_user_blocked") return t("chat.voice_call_blocked");
  }
  return chatErrorMessage(err, t, fallback);
}

/** The one line the ended panel says about why the call is over. */
export function voiceCallEndedMessage(ended: VoiceCallEndedState, t: TFunction): string {
  const name = ended.peerName;
  switch (ended.reason) {
    case "no_answer":
      return t("chat.voice_call_ended_no_answer");
    case "missed":
      return t("chat.voice_call_ended_missed");
    case "declined":
      return t("chat.voice_call_log_declined_outgoing");
    case "connect_failed":
      return voiceCallErrorMessage(ended.error, t, t("chat.voice_call_connect_failed"));
    case "start_failed":
      return voiceCallErrorMessage(ended.error, t, t("chat.voice_call_failed"));
    case "device":
      return ended.device ? voiceCallDeviceMessage(ended.device, t) : t("chat.voice_call_failed");
    case "peer_left":
      return t("chat.voice_call_ended_peer_left", { name });
    case "peer_unreachable":
      return t("chat.voice_call_ended_peer_unreachable", { name });
    case "alone":
      return t("chat.voice_call_ended_alone");
    case "everyone_left":
      return t("chat.voice_call_ended_everyone_left");
    case "peer_ended":
    default:
      return t("chat.voice_call_ended_peer_ended");
  }
}

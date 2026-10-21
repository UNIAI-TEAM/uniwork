// Copied from packages/views/chat/voice-call-copy.ts (voiceCallEndedMessage):
// the one line a phone call's ended panel says. The web's copy reads an
// ApiError and the web's device reasons, which the phone has not got, so this
// stays a copy; scripts/mobile-web-copies.test.mjs fails when the web's
// changes unreviewed. The call states, clocks and invites themselves are
// core's (@uniwork/core/chat/voice-call-{types,kind,invites}).
import type { VoiceCallEndedState } from "@uniwork/core/chat/voice-call-types";

type Translate = (key: string, params?: Record<string, string>) => string;

/** The codes voiceCallErrorMessage says in its own words: answers, not contract drift (data/report.ts; mobile only). */
export const VOICE_CALL_HANDLED_CODES = ["livekit_not_configured", "chat_user_blocked"] as const;

/** The server's refusal, in chat's own words (voice-call-copy.ts › voiceCallErrorMessage, never its raw message). */
function voiceCallErrorMessage(err: unknown, t: Translate, fallback: string): string {
  const code = (err as { body?: { error?: { code?: unknown } } } | undefined)?.body?.error?.code;
  if (code === "livekit_not_configured") return t("chat.voice_call_not_configured");
  if (code === "chat_user_blocked") return t("chat.voice_call_blocked");
  return fallback;
}

/**
 * The one line the ended panel says about why the call is over
 * (voice-call-copy.ts › voiceCallEndedMessage), for the reasons a phone call
 * can end with; the web's device and room-presence reasons read as "ended".
 */
export function voiceCallEndedMessage(ended: VoiceCallEndedState, t: Translate): string {
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
    default:
      return t("chat.voice_call_ended_peer_ended");
  }
}

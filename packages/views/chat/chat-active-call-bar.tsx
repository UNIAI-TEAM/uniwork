"use client";

import { Maximize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatVoiceCall } from "./chat-voice-call-host";
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";

/**
 * Telegram's call bar: while a call is folded to its pill, a slim strip in
 * the call accent across the top of the conversation says who you are on a
 * call with and how it stands; tapping it brings the call panel back, and the
 * hang-up is one press away. Nothing shows while the panel itself is open.
 */
export function ChatActiveCallBar() {
  const { t } = useTranslation();
  const { voiceCall, panelMode, expandCall, hangUp } = useChatVoiceCall();
  if (panelMode !== "minimized") return null;
  if (voiceCall.status !== "active" && voiceCall.status !== "connecting" && voiceCall.status !== "ringing") return null;
  const status =
    voiceCall.status === "active"
      ? t("chat.voice_call_connected")
      : voiceCall.status === "ringing"
        ? t("chat.voice_call_calling")
        : t("chat.voice_call_connecting");
  const hangUpLabel = isMultiPartyVoiceCall(voiceCall.callKind) ? t("chat.voice_call_leave") : t("chat.voice_call_end");
  return (
    <div
      role="region"
      aria-label={t("chat.voice_call_region_label", { name: voiceCall.peerName, status })}
      className="flex h-10 shrink-0 items-center gap-2 bg-call-accent pr-2 pl-4 text-on-solid"
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-on-solid ring-3 ring-on-solid/30 motion-safe:animate-pulse" />
      <button
        type="button"
        onClick={expandCall}
        className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left text-label font-semibold"
      >
        <span className="truncate">{voiceCall.peerName}</span>
        <span className="shrink-0 font-normal opacity-85">{`· ${status}`}</span>
      </button>
      <button
        type="button"
        aria-label={t("chat.voice_call_expand")}
        onClick={expandCall}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-on-solid/15 hover:bg-on-solid/25"
      >
        <Maximize2 aria-hidden className="size-4" />
      </button>
      <button
        type="button"
        onClick={hangUp}
        className="h-7 shrink-0 rounded-full bg-destructive-solid px-3 text-caption font-bold text-on-solid hover:bg-destructive-solid/90"
      >
        {hangUpLabel}
      </button>
    </div>
  );
}

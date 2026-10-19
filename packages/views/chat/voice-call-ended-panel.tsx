"use client";

import { useEffect, useRef } from "react";
import { MicOff, Phone, PhoneMissed, RefreshCw, VideoOff, WifiOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { voiceCallEndedMessage } from "./voice-call-copy";
import { useVoiceCallFaceIsSquare } from "./voice-call-face";
import { VoiceCallHangupIcon, VoiceCallLabeledAction } from "./voice-call-floating-panel";
import type { VoiceCallEndReason, VoiceCallEndedState } from "./voice-call-overlay-types";
import { PreConnectFloatingCall } from "./voice-call-pre-connect";

/** Reasons where trying again means the same call again, not calling back. */
const RETRY_REASONS = new Set<VoiceCallEndReason>(["connect_failed", "start_failed", "device"]);
const CALL_BACK_REASONS = new Set<VoiceCallEndReason>([
  "no_answer",
  "missed",
  "declined",
  "peer_unreachable",
]);

/** How it ended, as a mark on the face: missed (red), could not connect (amber), over (grey). */
function EndedBadge({ state }: { state: VoiceCallEndedState }) {
  const square = useVoiceCallFaceIsSquare();
  const icon = "size-3.5 stroke-[2.4]";
  let fill = "bg-tint-gray-solid";
  let glyph = <VoiceCallHangupIcon className={icon} />;
  if (CALL_BACK_REASONS.has(state.reason)) {
    fill = "bg-destructive-solid";
    glyph = <PhoneMissed aria-hidden className={icon} />;
  } else if (RETRY_REASONS.has(state.reason)) {
    fill = "bg-tint-yellow-solid";
    const Device = state.device?.kind === "videoinput" ? VideoOff : MicOff;
    glyph = state.reason === "device" ? <Device aria-hidden className={icon} /> : <WifiOff aria-hidden className={icon} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inline-flex size-8 items-center justify-center rounded-full border-3 border-call-plane text-on-solid",
        square ? "-right-1.5 -bottom-1.5" : "-right-1 -bottom-1",
        fill,
      )}
    >
      {glyph}
    </span>
  );
}

/**
 * What is left on screen when a call ends without the viewer hanging up:
 * why it ended, in one line, and the next sensible step (try again, call
 * back, close). A failure waits for the viewer; "the call ended" clears
 * itself after a few seconds.
 */
export function VoiceCallEndedPanel({
  state,
  onRetry,
  onDismiss,
}: {
  state: VoiceCallEndedState;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const message = voiceCallEndedMessage(state, t);
  const retry = RETRY_REASONS.has(state.reason);
  const callBack = CALL_BACK_REASONS.has(state.reason);
  const firstActionRef = useRef<HTMLDivElement>(null);

  // The call's own controls just disappeared under the viewer's focus; land
  // it on this panel's first action rather than leaving it on <body>.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    firstActionRef.current?.querySelector("button")?.focus();
  }, []);

  return (
    <PreConnectFloatingCall
      peerName={state.peerName}
      statusLabel={message}
      badge={<EndedBadge state={state} />}
      notice={
        state.reason === "device" && state.device?.failure === "denied" ? (
          <p className="text-center text-caption text-call-muted-foreground">
            {t("meetings.devicePreviewDeniedHint")}
          </p>
        ) : undefined
      }
    >
      <div ref={firstActionRef} className="contents">
        {retry || callBack ? (
          <VoiceCallLabeledAction
            label={retry ? t("common.retry") : t("chat.voice_call_call_back")}
            ariaLabel={retry ? t("common.retry") : t("chat.voice_call_call_back")}
            tone="accept"
            onClick={onRetry}
            icon={retry ? <RefreshCw aria-hidden className="size-6" /> : <Phone aria-hidden className="size-6.5" />}
          />
        ) : null}
        <VoiceCallLabeledAction
          label={t("common.close")}
          ariaLabel={t("common.close")}
          tone="neutral"
          onClick={onDismiss}
          icon={<X aria-hidden className="size-6" />}
        />
      </div>
    </PreConnectFloatingCall>
  );
}

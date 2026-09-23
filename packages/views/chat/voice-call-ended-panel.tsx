"use client";

import { useEffect, useRef } from "react";
import { Phone, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { voiceCallEndedMessage } from "./voice-call-copy";
import { VoiceCallLabeledAction } from "./voice-call-floating-panel";
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
      notice={
        state.reason === "device" && state.device?.failure === "denied" ? (
          <p className="mb-3 text-center text-caption text-muted-foreground">
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
            icon={retry ? <RotateCw aria-hidden className="size-5" /> : <Phone aria-hidden className="size-5" />}
            compact
          />
        ) : null}
        <VoiceCallLabeledAction
          label={t("common.close")}
          ariaLabel={t("common.close")}
          tone="neutral"
          onClick={onDismiss}
          icon={<X aria-hidden className="size-5" />}
          compact
        />
      </div>
    </PreConnectFloatingCall>
  );
}

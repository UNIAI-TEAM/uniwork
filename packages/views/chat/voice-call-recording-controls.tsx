"use client";

import { useId, useState } from "react";
import { CircleDot, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "../common/form-dialog";
import { CHAT_CONFIRM_CLASS } from "./chat-confirm-look";
import type { VoiceCallRecordingState } from "./use-voice-call-recording";
import { VoiceCallControl, VoiceCallRecordGlyph } from "./voice-call-control";

/**
 * While anyone records, everyone sees it — in every panel size, as a dot
 * and a word (never the colour alone), pulsing only when motion is fine.
 */
export function VoiceCallRecIndicator() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="voice-call-rec-indicator"
      className="inline-flex h-5 items-center gap-1.25 rounded-md bg-destructive-soft px-1.75 text-micro font-semibold text-destructive-soft-foreground"
    >
      <span className="size-1.5 rounded-full bg-destructive motion-safe:animate-pulse" aria-hidden />
      {t("chat.voice_call_record_live")}
    </span>
  );
}

/**
 * The record control keeps one name ("Ghi âm cuộc gọi") and reports its
 * state through aria-pressed, like the device controls beside it. Where the
 * workspace has not turned recording on, it stays focusable but inert and
 * its tooltip says why, instead of failing after the click.
 */
export function VoiceCallRecordControl({
  recording: state,
  disabled,
  large = false,
}: {
  recording: VoiceCallRecordingState;
  disabled?: boolean;
  /** Fullscreen: the bigger circle with its name under it, like its neighbours. */
  large?: boolean;
}) {
  const { t } = useTranslation();
  const { recording, recordingEnabled, pending, start, stop } = state;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hintId = useId();
  const label = t("chat.voice_call_record_start");
  const unavailable = !recordingEnabled && !recording;
  const tooltip = unavailable ? t("chat.voice_call_record_not_configured") : label;

  const toggle = () => {
    if (unavailable || pending) return;
    if (recording) {
      void stop();
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <>
      {/* Recording reads as the soft red with a stop square, so it never
          looks like the solid-red hang-up beside it. */}
      <VoiceCallControl
        label={label}
        tooltip={unavailable ? tooltip : undefined}
        pressed={recording}
        tone={recording ? "recording" : unavailable ? "unavailable" : "record"}
        large={large}
        ariaDisabled={unavailable || pending}
        describedBy={unavailable ? hintId : undefined}
        disabled={disabled}
        onClick={toggle}
      >
        {recording ? <Square aria-hidden className="size-4.5 fill-current" /> : <VoiceCallRecordGlyph hollow={unavailable} />}
      </VoiceCallControl>
      {unavailable ? (
        <span id={hintId} className="sr-only">
          {tooltip}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("chat.voice_call_record_confirm_title")}
        description={t("chat.voice_call_record_confirm")}
        confirmLabel={t("chat.voice_call_record_confirm_action")}
        destructive={false}
        icon={CircleDot}
        tone="destructive"
        cancelVariant="secondary"
        className={CHAT_CONFIRM_CLASS}
        pending={pending}
        onConfirm={() => {
          void start().then(() => setConfirmOpen(false));
        }}
      />
    </>
  );
}

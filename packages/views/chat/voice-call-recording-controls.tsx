"use client";

import { useId, useState } from "react";
import { Circle, CircleDot, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { CHAT_CONFIRM_CLASS } from "./chat-confirm-look";
import type { VoiceCallRecordingState } from "./use-voice-call-recording";

/**
 * While anyone records, everyone sees it — in every panel size, as a dot
 * and a word (never the colour alone), pulsing only when motion is fine.
 */
export function VoiceCallRecIndicator() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="voice-call-rec-indicator"
      className="inline-flex items-center gap-1.5 rounded-sm bg-destructive-soft px-2 py-0.5 text-micro font-semibold text-destructive-soft-foreground"
    >
      <span className="size-1.5 rounded-full bg-destructive-solid motion-safe:animate-pulse" aria-hidden />
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
  className,
}: {
  recording: VoiceCallRecordingState;
  disabled?: boolean;
  /** The row's round size, so the record control matches its neighbours. */
  className?: string;
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
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              // Recording reads as the soft red with a stop square, so it never
              // looks like the solid-red hang-up beside it.
              variant={recording ? "destructive" : "meetingChip"}
              size="icon"
              className={cn(
                "size-13 rounded-full",
                className,
                recording ? "border-destructive/60" : "border-transparent",
              )}
              aria-label={label}
              aria-pressed={recording}
              aria-disabled={unavailable || pending || undefined}
              aria-describedby={unavailable ? hintId : undefined}
              disabled={disabled}
              onClick={toggle}
            />
          }
        >
          {recording ? (
            <Square aria-hidden className="size-4 fill-current" />
          ) : (
            <Circle
              aria-hidden
              className={cn("size-5", recordingEnabled ? "fill-destructive text-destructive" : "text-muted-foreground")}
            />
          )}
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
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

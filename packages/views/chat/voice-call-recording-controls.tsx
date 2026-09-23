"use client";

import { useId, useState } from "react";
import { Circle, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
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
      className="inline-flex items-center gap-1 rounded-md bg-destructive-soft px-1.5 py-0.5 text-micro font-semibold text-destructive-soft-foreground"
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
}: {
  recording: VoiceCallRecordingState;
  disabled?: boolean;
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
              variant="outline"
              size="icon-lg"
              className={cn(
                "size-11 rounded-xl",
                recording &&
                  "border-transparent bg-destructive-solid text-on-solid hover:bg-destructive-solid hover:opacity-90",
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
            <Square aria-hidden className="size-3.5 fill-current" />
          ) : (
            <Circle
              aria-hidden
              className={cn("size-4", recordingEnabled ? "fill-destructive text-destructive" : "text-muted-foreground")}
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
        pending={pending}
        onConfirm={() => {
          void start().then(() => setConfirmOpen(false));
        }}
      />
    </>
  );
}

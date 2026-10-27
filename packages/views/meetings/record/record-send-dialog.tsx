"use client";
import { AudioLines, CircleAlert, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatVoiceCallDuration } from "@uniwork/core/chat/voice-call-duration";
import type { SendPhase } from "@uniwork/core/meetings/recorder";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { cn } from "@uniwork/ui/lib/utils";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { Notice } from "../../common/notice";
import { formatBytes } from "../../documents/doclist/format";
import { meetingLocale } from "../meeting-datetime";
import { uploadFailure } from "../meeting-recording-upload";

/**
 * Sending the in-app recording (boards 6, 7): the upload dialog's frame with
 * one file row for every part on this device. Offline it waits and says so;
 * any other failure is worded as the upload dialog words it. Stopping or
 * leaving it for later keeps the parts on the device.
 */
export function RecordSendDialog({
  phase,
  percent,
  sentBytes,
  totalBytes,
  seconds,
  error,
  onStop,
  onRetry,
  onLater,
}: {
  phase: SendPhase;
  percent: number;
  sentBytes: number;
  totalBytes: number;
  seconds: number;
  error: unknown;
  onStop: () => void;
  onRetry: () => void;
  onLater: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const waiting = phase === "waiting";
  const failure = phase === "failed" ? uploadFailure(error, t) : null;
  // Waiting and failed have stopped sending: what is left is to try again or come back later.
  const halted = waiting || phase === "failed";
  const title = waiting ? "meetings.record.waitingTitle" : phase === "failed" ? "meetings.record.failedTitle" : "meetings.record.sendingTitle";
  const body = waiting ? "meetings.record.waitingBody" : phase === "failed" ? "meetings.record.failedBody" : "meetings.record.sendingBody";
  const total = formatBytes(totalBytes, locale);

  return (
    <Dialog
      open
      // Mid-send, a stray click or Esc must not stop it: only the X and "Dừng gửi" do.
      disablePointerDismissal={!halted}
      onOpenChange={(open, details) => {
        if (open || (!halted && details.reason !== "close-press")) return;
        if (halted) onLater();
        else onStop();
      }}
    >
      <FormDialogContent>
        <FormDialogHeader title={t(title)} description={t(body)} />
        <FormDialogBody className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
              <AudioLines aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-foreground">
                {t("meetings.record.fileLabel", { duration: formatVoiceCallDuration(seconds) })}
              </p>
              <p className="text-caption tabular-nums text-muted-foreground">
                {/* Before the first byte goes, only the size: "— / 31 MB" says nothing. */}
                {sentBytes > 0 ? t("meetings.record.sentOfTotal", { sent: formatBytes(sentBytes, locale), total }) : total}
              </p>
            </div>
            <span className={cn("shrink-0 text-body tabular-nums", waiting ? "text-warning" : "text-foreground")}>
              {waiting ? t("meetings.record.pausedShort") : t("meetings.record.percent", { percent })}
            </span>
          </div>
          {/* One persistent live region (it holds no other text): the offline line comes and goes with the network. */}
          <div role="status" className="space-y-3">
            <Progress
              value={percent}
              aria-label={t(title)}
              className={cn(
                "[&_[data-slot=progress-indicator]]:rounded-full [&_[data-slot=progress-track]]:h-1.5",
                waiting && "[&_[data-slot=progress-indicator]]:bg-warning",
              )}
            />
            {waiting ? (
              <p className="flex items-center gap-1.5 text-caption text-warning">
                <WifiOff aria-hidden className="size-3.5 shrink-0" />
                {t("meetings.record.offline")}
              </p>
            ) : null}
          </div>
          {failure ? (
            <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive">
              {failure.message}
            </Notice>
          ) : null}
        </FormDialogBody>
        {halted ? (
          <FormDialogFooter
            leading={waiting ? <p>{t("meetings.record.keepOpen")}</p> : undefined}
            cancelLabel={t("meetings.record.later")}
            onCancel={onLater}
            submitLabel={waiting || failure?.retry ? t("meetings.record.retryNow") : undefined}
            onSubmit={onRetry}
          />
        ) : (
          // "Đang gửi…" says what is happening; there is nothing to press until it is done.
          <FormDialogFooter
            leading={<p>{t("meetings.record.keepOpen")}</p>}
            cancelLabel={t("meetings.record.stopSending")}
            onCancel={onStop}
            submitLabel={t("meetings.record.sending")}
            submitDisabled
          />
        )}
      </FormDialogContent>
    </Dialog>
  );
}

"use client";
import { useId, useRef, useState } from "react";
import { CircleAlert, FileHeadphone, RefreshCw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingTranscriptions, useUploadMeetingRecording } from "@uniwork/core/meetings/transcriptions";
import type { MeetingTranscription } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../api-error-copy";
import { Notice } from "../common/notice";
import { formatFileSize } from "../documents/document-format";
import { useFileDropZone } from "../editor/use-file-drop-zone";
import { meetingLocale } from "./meeting-datetime";

/** The meeting_audio cap on the server (parent spec §5.5); said as "2 GB". */
const MAX_BYTES = 2 * 1024 ** 3;
const ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/webm,video/mp4,.mp3,.m4a,.wav,.ogg,.oga,.opus,.webm,.mp4";

/**
 * "Upload recording" (parent spec §9.2 item 3): a clerk sends the recording of
 * an ended meeting held without a room, and UNI transcribes it in batch. The
 * caller decides who sees it (the workspace has batch transcription). A
 * refusal stays in the dialog with the chosen file, ready to send again.
 */
export function MeetingRecordingUploadDialog({
  meetingId,
  onOpenChange,
}: {
  meetingId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const picked = useRef<File | null>(null);
  const [language, setLanguage] = useState<"vi" | "en">(i18n.language.startsWith("en") ? "en" : "vi");
  const [consent, setConsent] = useState(false);
  const [percent, setPercent] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const upload = useUploadMeetingRecording(meetingId);
  const tooLarge = (file?.size ?? 0) > MAX_BYTES;
  const ready = Boolean(file) && !tooLarge && consent && !upload.isPending;
  const reason = upload.isPending ? null : !file ? t("meetings.transcription.needFile") : !consent ? t("meetings.transcription.needConsent") : null;

  const pick = (next: File | null) => {
    if (upload.isPending) return;
    picked.current = next;
    setFile(next);
    setFailure(null);
    setDuration(undefined);
    if (next) {
      void readMediaDuration(next).then((d) => {
        if (picked.current === next) setDuration(d);
      });
    }
  };
  const { isDragOver, dropZoneProps } = useFileDropZone({
    onDrop: (files) => pick(files[0] ?? null),
    enabled: !upload.isPending,
  });

  const send = () => {
    if (!file || !ready) return;
    setFailure(null);
    upload.mutate(
      { file, language, consent, durationSeconds: duration, onProgress: (sent, total) => setPercent(total ? Math.floor((sent / total) * 100) : 0) },
      {
        onSuccess: () => {
          toast.success(t("meetings.transcription.queued"));
          onOpenChange(false);
        },
        onError: (err) => {
          const detail = apiErrorCopy(err);
          setFailure(detail ? `${t("meetings.transcription.failed")} ${detail}` : t("meetings.transcription.failed"));
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (upload.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{t("meetings.transcription.title")}</DialogTitle>
            <DialogDescription>{t("meetings.transcription.description")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={tooLarge || undefined}>
            <FieldLabel htmlFor={`${id}-file`}>{t("meetings.transcription.fileLabel")}</FieldLabel>
            {/* A styled picker over the native input: the browser's own button
                speaks the browser's language ("Choose File"). The input stays
                in the tab order; the zone shows its focus and takes a drop. */}
            <label
              {...dropZoneProps}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input px-4 py-5 text-center transition-colors hover:bg-muted/50",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                isDragOver && "border-brand bg-brand-subtle",
                upload.isPending && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                id={`${id}-file`}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-describedby={`${id}-file-hint`}
                aria-invalid={tooLarge || undefined}
                disabled={upload.isPending}
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <FileHeadphone aria-hidden className="size-5 text-muted-foreground" />
                  <span className="max-w-full truncate text-body font-medium text-foreground">{file.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {formatFileSize(file.size, meetingLocale(i18n.language))}
                    {"\u00a0· "}
                    {t("meetings.transcription.changeFile")}
                  </span>
                </>
              ) : (
                <>
                  <Upload aria-hidden className="size-5 text-muted-foreground" />
                  <span className="text-body font-medium text-foreground">{t("meetings.transcription.chooseFile")}</span>
                  <span className="text-caption text-muted-foreground">{t("meetings.transcription.dropHint")}</span>
                </>
              )}
            </label>
            {tooLarge ? (
              <FieldError id={`${id}-file-hint`}>{t("meetings.transcription.tooLarge")}</FieldError>
            ) : (
              <FieldDescription id={`${id}-file-hint`}>{t("meetings.transcription.fileHint")}</FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel id={`${id}-language`}>{t("meetings.transcription.languageLabel")}</FieldLabel>
            <RadioGroup
              aria-labelledby={`${id}-language`}
              value={language}
              onValueChange={(v) => setLanguage(v === "en" ? "en" : "vi")}
              className="flex gap-4"
            >
              {(["vi", "en"] as const).map((l) => (
                <label key={l} className="flex items-center gap-2 text-body text-foreground">
                  <RadioGroupItem value={l} />
                  {t(`meetings.transcription.language_${l}`)}
                </label>
              ))}
            </RadioGroup>
          </Field>
          <label className="flex items-start gap-2 text-body text-foreground">
            <Checkbox
              checked={consent}
              onCheckedChange={(next) => setConsent(next === true)}
              aria-describedby={`${id}-consent-hint`}
            />
            <span>
              {t("meetings.transcription.consent")}
              <span id={`${id}-consent-hint`} className="mt-0.5 block text-caption text-muted-foreground">
                {t("meetings.transcription.consentHint")}
              </span>
            </span>
          </label>
          {upload.isPending ? (
            <Progress value={percent} aria-label={t("meetings.transcription.uploading", { percent })}>
              <span className="text-caption tabular-nums text-muted-foreground">
                {t("meetings.transcription.uploading", { percent })}
              </span>
            </Progress>
          ) : null}
          {failure ? (
            <Notice
              tone="destructive"
              icon={CircleAlert}
              layout="inline"
              live="assertive"
              action={
                <Button type="button" size="sm" variant="outline" onClick={send}>
                  <RefreshCw aria-hidden />
                  {t("common.retry")}
                </Button>
              }
            >
              {failure}
            </Notice>
          ) : null}
          {reason ? (
            <p id={`${id}-reason`} className="sr-only">
              {reason}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              aria-disabled={upload.isPending || undefined}
              onClick={() => {
                if (!upload.isPending) onOpenChange(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              aria-disabled={!ready || undefined}
              aria-busy={upload.isPending || undefined}
              aria-describedby={reason ? `${id}-reason` : undefined}
            >
              {upload.isPending ? <Spinner /> : null}
              {t("meetings.transcription.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The recording's length from the browser's own media metadata, for the
 * server's up-front quota estimate (it clamps the value by the file size and
 * bills what the vendor measures). Undefined when the browser cannot tell:
 * the server then estimates from the size.
 */
const MEDIA_PROBE_MS = 5000;

function readMediaDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(undefined);
      return;
    }
    // A video element reads audio files too.
    const media = document.createElement("video");
    // A browser that never answers gives up after 5 s, like one that cannot.
    const timer = setTimeout(() => done(undefined), MEDIA_PROBE_MS);
    function done(seconds: number | undefined) {
      clearTimeout(timer);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(seconds);
    }
    media.preload = "metadata";
    media.onloadedmetadata = () => done(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined);
    media.onerror = () => done(undefined);
    media.src = url;
  });
}

const STATUSES = new Set(["QUEUED", "RUNNING", "COMPLETE", "FAILED"]);
const ERRORS = new Set(["file_unavailable", "provider_error", "timeout"]);

/**
 * Where the latest uploaded recording stands, for everyone who reads the
 * transcript. One persistent live region, so a change (queued → done, or
 * failed) is announced; a failure reads as an error with the way forward.
 */
export function MeetingTranscriptionStatus({ meetingId, onRetry }: { meetingId: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  const { data } = useMeetingTranscriptions(meetingId);
  const latest: MeetingTranscription | undefined = data?.[0];
  const known = latest && STATUSES.has(latest.status) ? latest : undefined;
  const failed = known?.status === "FAILED";
  const busy = known?.status === "QUEUED" || known?.status === "RUNNING";
  const text = known
    ? t(`meetings.transcription.status.${known.status}`, { file: known.filename || "—" }) +
      (failed && known.error_code && ERRORS.has(known.error_code) ? ` ${t(`meetings.transcription.error.${known.error_code}`)}` : "")
    : "";
  return (
    <div role="status" aria-live="polite" data-testid="meeting-transcription-status" className="empty:hidden">
      {!known ? null : failed ? (
        <Notice
          tone="destructive"
          icon={CircleAlert}
          layout="inline"
          live="off"
          action={
            onRetry ? (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <Upload aria-hidden />
                {t("meetings.transcription.uploadAgain")}
              </Button>
            ) : undefined
          }
        >
          {text}
        </Notice>
      ) : (
        <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
          {busy ? <Spinner /> : <FileHeadphone aria-hidden className="size-3.5 shrink-0" />}
          <span className="min-w-0 break-words">{text}</span>
        </p>
      )}
    </div>
  );
}

"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, FileHeadphone, Info, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, errorClassOf, errorCode } from "@uniwork/core/api";
import { ChunkedUploadError } from "@uniwork/core/documents/chunked-upload";
import { useMeetingTranscriptions, useUploadMeetingRecording } from "@uniwork/core/meetings/transcriptions";
import type { MeetingTranscription } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog, FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { Notice } from "../common/notice";
import { formatBytes } from "../documents/doclist/format";
import { useFileDropZone } from "../editor/use-file-drop-zone";
import { meetingLocale } from "./meeting-datetime";
import { formatMeetingMoment } from "./meeting-detail-format";
import { EarlierTranscriptions, TranscriptionDeleteButton } from "./transcript/meeting-transcription-delete";

/** The meeting_audio cap on the server (parent spec §5.5); said as "2 GB". */
const MAX_BYTES = 2 * 1024 ** 3;
const ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/webm,video/mp4,.mp3,.m4a,.wav,.ogg,.oga,.opus,.webm,.mp4";
const ACCEPTED = ACCEPT.split(",");

/** What the native picker would have let through: a listed type or extension (a drop bypasses `accept`). */
function acceptable(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((a) => (a.startsWith(".") ? name.endsWith(a) : file.type === a));
}

type Translate = ReturnType<typeof useTranslation>["t"];

/** Refusals that sending the same file again cannot fix, worded by the client. */
const REFUSALS: Readonly<Record<string, string>> = {
  file_too_large: "meetings.transcription.tooLarge",
  unsupported_media_type: "meetings.transcription.uploadError.unsupported",
  quota_exceeded: "meetings.transcription.uploadError.quota",
  transcription_unavailable: "meetings.transcription.uploadError.unavailable",
  transcription_in_progress: "meetings.transcription.uploadError.inProgress",
  // The plan, not the file: another file would be refused the same way.
  entitlement_required: "meetings.transcription.uploadError.plan",
  subscription_inactive: "meetings.transcription.uploadError.plan",
  // Other uploads still open: Retry cannot help until they finish or expire.
  upload_sessions_exhausted: "meetings.transcription.uploadError.tooManyUploads",
};

/**
 * The sentence for a failed upload and whether Retry can help: a lost
 * connection or a server hiccup resumes where it stopped; a refusal of the
 * file itself does not. Null for a cancel the user asked for.
 */
function uploadFailure(err: unknown, t: Translate): { message: string; retry: boolean } | null {
  if (err instanceof ChunkedUploadError && err.code === "upload_canceled") return null;
  // The session is gone (it expired, or another tab stopped it): the same file sends again, from the start.
  if (errorCode(err) === "upload_session_expired") return { message: t("meetings.transcription.uploadError.expired"), retry: true };
  const refusal = REFUSALS[errorCode(err) ?? ""] ?? (errorClassOf(err) === "quota" ? REFUSALS.quota_exceeded : undefined);
  if (refusal) return { message: t(refusal), retry: false };
  // fetch rejects with a TypeError ("Failed to fetch") when the network drops.
  if (err instanceof TypeError) return { message: t("meetings.transcription.uploadError.network"), retry: true };
  if (err instanceof ApiError && err.status < 500 && ![408, 409, 429].includes(err.status)) {
    return { message: t("meetings.transcription.uploadError.refused"), retry: false };
  }
  return { message: t("meetings.transcription.failed"), retry: true };
}

/**
 * "Upload recording" (parent spec §9.2 item 3): a clerk sends the recording of
 * an ended meeting held without a room, and UNI transcribes it in batch. The
 * caller decides who sees it (the workspace has batch transcription). A
 * refusal stays in the dialog with the chosen file; Retry resumes the upload
 * where it stopped. Leaving the page mid-upload asks first; closing the dialog
 * asks whether to stop it.
 */
export function MeetingRecordingUploadDialog({
  meetingId,
  onOpenChange,
  focusAfterUpload,
  replacesLive = false,
}: {
  meetingId: string;
  onOpenChange: (open: boolean) => void;
  /** The meeting has lines from the room (scribe, captions) that a completed upload replaces (UNI-1995 #11). */
  replacesLive?: boolean;
  /**
   * Where focus lands once the upload is queued: the button that opened the
   * dialog (a failed run's "Tải lên lại") leaves when the list refetches.
   */
  focusAfterUpload?: () => HTMLElement | null;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const picked = useRef<File | null>(null);
  const [language, setLanguage] = useState<"vi" | "en">(i18n.language.startsWith("en") ? "en" : "vi");
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<{ message: string; retry: boolean } | null>(null);
  const [askStop, setAskStop] = useState(false);
  const queued = useRef(false);
  const upload = useUploadMeetingRecording(meetingId);
  const pending = upload.isPending;
  const tooLarge = (file?.size ?? 0) > MAX_BYTES;
  const ready = Boolean(file) && !tooLarge && consent && !pending;
  const reason = pending
    ? null
    : !file
      ? t("meetings.transcription.needFile")
      : tooLarge
        ? t("meetings.transcription.needSmallerFile")
        : !consent
          ? t("meetings.transcription.needConsent")
          : null;
  // Every byte is sent once the engine verifies: the bar would sit at 100%.
  const processing = upload.phase === "verifying" || upload.phase === "done";
  // The file is in and the transcription is being queued: too late to stop, so nothing offers to.
  const queueing = pending && upload.phase === "done";

  // A tab closed mid-upload loses nothing (the session resumes), but the
  // transcription would never be queued: the browser asks first.
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);

  const pick = (next: File | null) => {
    if (pending) return;
    if (next && !acceptable(next)) {
      setRejected(next.name);
      return;
    }
    setRejected(null);
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
    enabled: !pending,
  });

  const send = () => {
    if (!file || !ready) return;
    setFailure(null);
    upload.mutate(
      { file, language, consent, durationSeconds: duration },
      {
        onSuccess: () => {
          toast.success(t("meetings.transcription.queued"));
          queued.current = true;
          onOpenChange(false);
        },
        onError: (err) => setFailure(uploadFailure(err, t)),
      },
    );
  };

  const stop = () => {
    setAskStop(false);
    void upload.cancel().then(() => onOpenChange(false));
  };

  const hintId = `${id}-file-hint`;
  return (
    <Dialog open onOpenChange={(next) => (next || queueing ? undefined : pending ? setAskStop(true) : onOpenChange(false))}>
      <FormDialogContent
        showCloseButton={!pending}
        finalFocus={() => (queued.current && focusAfterUpload ? focusAfterUpload() : true)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <FormDialogHeader title={t("meetings.transcription.title")} description={t("meetings.transcription.description")} />
          <FormDialogBody>
            {replacesLive ? (
              <Notice tone="info" icon={Info} layout="inline" live="off">
                {t("meetings.transcription.replacesLive")}
              </Notice>
            ) : null}
            <Field data-invalid={tooLarge || rejected ? true : undefined}>
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
                  pending && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  id={`${id}-file`}
                  type="file"
                  accept={ACCEPT}
                  className="sr-only"
                  aria-describedby={hintId}
                  aria-invalid={tooLarge || rejected ? true : undefined}
                  disabled={pending}
                  onChange={(e) => pick(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <>
                    <FileHeadphone aria-hidden className="size-5 text-muted-foreground" />
                    <span className="max-w-full truncate text-body font-medium text-foreground">{file.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {formatBytes(file.size, meetingLocale(i18n.language))}
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
              {rejected ? (
                <FieldError id={hintId} className="wrap-anywhere">
                  {t("meetings.transcription.wrongType", { file: rejected })}
                </FieldError>
              ) : tooLarge ? (
                <FieldError id={hintId}>{t("meetings.transcription.tooLarge")}</FieldError>
              ) : (
                <FieldDescription id={hintId}>{t("meetings.transcription.fileHint")}</FieldDescription>
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
                aria-required
                aria-describedby={`${id}-consent-hint`}
              />
              <span>
                {t("meetings.transcription.consent")}
                <span id={`${id}-consent-hint`} className="mt-0.5 block text-caption text-muted-foreground">
                  {t("meetings.transcription.consentHint")}
                </span>
              </span>
            </label>
            {/* Announces each phase once; the bar's percent would speak on every step. */}
            <p role="status" className="sr-only">
              {pending ? t(processing ? "meetings.transcription.processing" : "meetings.transcription.uploadingStarted") : ""}
            </p>
            {pending ? (
              <Progress
                value={processing ? null : upload.percent}
                aria-label={processing ? t("meetings.transcription.processing") : t("meetings.transcription.uploading", { percent: upload.percent })}
              >
                <span className="flex items-center gap-1.5 text-caption tabular-nums text-muted-foreground">
                  {processing ? <Spinner /> : null}
                  {processing ? t("meetings.transcription.processing") : t("meetings.transcription.uploading", { percent: upload.percent })}
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
                  failure.retry ? (
                    <Button type="button" size="sm" variant="outline" onClick={send}>
                      <RefreshCw aria-hidden />
                      {t("common.retry")}
                    </Button>
                  ) : undefined
                }
              >
                {failure.message}
              </Notice>
            ) : null}
          </FormDialogBody>
          <FormDialogFooter
            leading={reason ? <p id={`${id}-reason`}>{reason}</p> : undefined}
            reasonId={reason ? `${id}-reason` : undefined}
            cancelLabel={pending ? t("meetings.transcription.stop") : undefined}
            onCancel={() => (pending ? stop() : onOpenChange(false))}
            submitting={queueing}
            submitLabel={t("meetings.transcription.submit")}
            submitType="submit"
            submitDisabled={!ready}
          />
        </form>
      </FormDialogContent>
      <ConfirmDialog
        open={askStop}
        onOpenChange={setAskStop}
        nested
        title={t("meetings.transcription.stopTitle")}
        description={t("meetings.transcription.stopDescription")}
        confirmLabel={t("meetings.transcription.stop")}
        cancelLabel={t("meetings.transcription.keepUploading")}
        onConfirm={stop}
      />
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
 * transcript, with the real time it got there ("· từ 14:05" while it waits or
 * runs, "· lúc 14:20" once it ends). One persistent live region, so a change
 * (queued → done, or failed) is announced; a failure reads as an error with
 * the way forward.
 */
export function MeetingTranscriptionStatus({
  meetingId,
  onRetry,
  canDelete = false,
}: {
  meetingId: string;
  onRetry?: () => void;
  /** A clerk may delete a finished upload with its lines and its recording (UNI-1995 #5). */
  canDelete?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data } = useMeetingTranscriptions(meetingId);
  const latest: MeetingTranscription | undefined = data?.[0];
  const known = latest && STATUSES.has(latest.status) ? latest : undefined;
  const failed = known?.status === "FAILED";
  const busy = known?.status === "QUEUED" || known?.status === "RUNNING";
  const iso = busy ? known?.created_at : known?.completed_at;
  const time = formatMeetingMoment(iso, meetingLocale(i18n.language));
  const when = time ? t(busy ? "meetings.transcription.since" : "meetings.transcription.at", { time }) : "";
  const text = known
    ? t(`meetings.transcription.status.${known.status}`, { file: known.filename || "—" }) + (when ? ` · ${when}` : "")
    : "";
  const reason =
    failed && known?.error_code && ERRORS.has(known.error_code) ? ` ${t(`meetings.transcription.error.${known.error_code}`)}` : "";
  const deletable = canDelete && known && !busy;
  return (
    <>
      {/* The delete button sits beside the live region, not in it; nothing shows while the region is empty. */}
      <div className="flex items-center gap-1 has-[>[role=status]:empty]:hidden">
        <div role="status" aria-live="polite" data-testid="meeting-transcription-status" className="min-w-0 flex-1 empty:hidden">
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
              {/* A long file name has no space to break at. */}
              <span className="wrap-anywhere">{`${text}.${reason}`}</span>
            </Notice>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
              {busy ? <Spinner /> : <FileHeadphone aria-hidden className="size-3.5 shrink-0" />}
              <span className="min-w-0 wrap-anywhere">{text}</span>
            </p>
          )}
        </div>
        {deletable ? (
          <TranscriptionDeleteButton meetingId={meetingId} transcription={known} label={t("meetings.transcription.delete")} />
        ) : null}
      </div>
      {canDelete && data ? <EarlierTranscriptions meetingId={meetingId} transcriptions={data.slice(1)} /> : null}
    </>
  );
}

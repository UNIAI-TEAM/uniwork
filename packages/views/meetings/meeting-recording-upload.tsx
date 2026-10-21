"use client";
import { useId, useRef, useState } from "react";
import { CircleAlert, FileHeadphone, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingCapabilities } from "@uniwork/core/meetings";
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
import { Input } from "@uniwork/ui/components/ui/input";
import { Progress } from "@uniwork/ui/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../toast-api-error";

/** The meeting_audio cap on the server (parent spec §5.5). */
const MAX_BYTES = 2 * 1024 ** 3;
const ACCEPT = "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/webm,video/mp4,.mp3,.m4a,.wav,.ogg,.oga,.opus,.webm,.mp4";

/**
 * "Upload recording" (parent spec §9.2 item 3): a clerk sends the recording of
 * an ended meeting held without a room, and UNI transcribes it in batch.
 * Shown when the workspace has batch transcription.
 */
export function MeetingRecordingUploadButton({ workspaceId, meetingId }: { workspaceId: string; meetingId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const caps = useMeetingCapabilities(workspaceId);
  if (!caps.data?.transcription) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <Upload aria-hidden className="size-3.5" />
        {t("meetings.transcription.uploadButton")}
      </Button>
      {open ? <MeetingRecordingUploadDialog meetingId={meetingId} onOpenChange={setOpen} /> : null}
    </>
  );
}

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
  const upload = useUploadMeetingRecording(meetingId);
  const tooLarge = (file?.size ?? 0) > MAX_BYTES;
  const ready = Boolean(file) && !tooLarge && consent && !upload.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !ready) return;
    upload.mutate(
      { file, language, consent, durationSeconds: duration, onProgress: (sent, total) => setPercent(total ? Math.floor((sent / total) * 100) : 0) },
      {
        onSuccess: () => {
          toast.success(t("meetings.transcription.queued"));
          onOpenChange(false);
        },
        onError: (err) => toastApiError(err, t("meetings.transcription.title")),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (upload.isPending ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("meetings.transcription.title")}</DialogTitle>
            <DialogDescription>{t("meetings.transcription.description")}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={tooLarge || undefined}>
            <FieldLabel htmlFor={`${id}-file`}>{t("meetings.transcription.fileLabel")}</FieldLabel>
            <Input
              id={`${id}-file`}
              type="file"
              accept={ACCEPT}
              aria-describedby={`${id}-file-hint`}
              aria-invalid={tooLarge || undefined}
              disabled={upload.isPending}
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                picked.current = next;
                setFile(next);
                setDuration(undefined);
                if (next) {
                  void readMediaDuration(next).then((d) => {
                    if (picked.current === next) setDuration(d);
                  });
                }
              }}
            />
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
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={upload.isPending} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!ready}>
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
    const done = (seconds: number | undefined) => {
      media.onloadedmetadata = null;
      media.onerror = null;
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => done(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined);
    media.onerror = () => done(undefined);
    media.src = url;
  });
}

const STATUSES = new Set(["QUEUED", "RUNNING", "COMPLETE", "FAILED"]);
const ERRORS = new Set(["file_unavailable", "provider_error", "timeout"]);

/** Where the latest uploaded recording stands, for everyone who reads the transcript. */
export function MeetingTranscriptionStatus({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const { data } = useMeetingTranscriptions(meetingId);
  const latest: MeetingTranscription | undefined = data?.[0];
  if (!latest || !STATUSES.has(latest.status)) return null;
  const failed = latest.status === "FAILED";
  const busy = latest.status === "QUEUED" || latest.status === "RUNNING";
  const Icon = failed ? CircleAlert : FileHeadphone;
  return (
    <p data-testid="meeting-transcription-status" className="flex items-center gap-1.5 text-caption text-muted-foreground">
      {busy ? <Spinner /> : <Icon aria-hidden className="size-3.5 shrink-0" />}
      <span>
        {t(`meetings.transcription.status.${latest.status}`, { file: latest.filename || "—" })}
        {failed && latest.error_code && ERRORS.has(latest.error_code)
          ? ` · ${t(`meetings.transcription.error.${latest.error_code}`)}`
          : null}
      </span>
    </p>
  );
}

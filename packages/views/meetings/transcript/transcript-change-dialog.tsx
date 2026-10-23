"use client";
import { useId, useState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDeleteTranscript, useEditTranscriptSegment } from "@uniwork/core/meetings/transcript";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Select } from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ConfirmDialog, FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../../common/form-dialog";
import { Notice } from "../../common/notice";

/** What a clerk asked to change (UNI-1995 #5). */
export type TranscriptChange =
  | { kind: "edit"; segment: MeetingTranscriptSegment }
  | { kind: "delete"; segment: MeetingTranscriptSegment }
  | { kind: "range"; segment: MeetingTranscriptSegment; after: MeetingTranscriptSegment[] }
  | { kind: "all" };

/** The most later lines a range end offers: enough for a stretch, light for the list. */
const RANGE_CHOICES = 200;

/**
 * The confirm or form for one change. Every change awaits the server: a
 * deletion is not locally predictable (a stretch spans sources the reader
 * does not see), and the summary's "changed" mark comes back with it.
 */
export function TranscriptChangeDialog({
  meetingId,
  change,
  speakerOf,
  clock,
  onClose,
}: {
  meetingId: string;
  change: TranscriptChange;
  speakerOf: (s: MeetingTranscriptSegment) => string;
  clock: (iso: string) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const edit = useEditTranscriptSegment(meetingId);
  const remove = useDeleteTranscript(meetingId);
  const pending = edit.isPending || remove.isPending;
  const failed = edit.isError || remove.isError;
  const id = useId();
  const [text, setText] = useState(change.kind === "edit" ? change.segment.text : "");
  const choices = change.kind === "range" ? [change.segment, ...change.after].slice(0, RANGE_CHOICES) : [];
  const [endId, setEndId] = useState(change.kind === "range" ? change.segment.id : "");
  const close = (open: boolean) => {
    if (!open && !pending) onClose();
  };
  const failure = failed ? (
    <Notice tone="destructive" icon={CircleAlert} layout="inline" live="assertive">
      {t("meetings.transcriptChangeFailed")}
    </Notice>
  ) : null;

  if (change.kind === "edit" || change.kind === "range") {
    const blank = change.kind === "edit" && text.trim() === "";
    const submit = () => {
      if (pending || blank) return;
      if (change.kind === "edit") {
        void edit.mutateAsync({ segmentId: change.segment.id, text: text.trim() }).then(onClose, () => undefined);
        return;
      }
      const end = choices.find((s) => s.id === endId) ?? change.segment;
      // The server deletes [from, to): one millisecond past the last line keeps it inside.
      const from = new Date(Date.parse(change.segment.spoken_at)).toISOString();
      const to = new Date(Date.parse(end.spoken_at) + 1).toISOString();
      void remove.mutateAsync({ from, to }).then(onClose, () => undefined);
    };
    return (
      <Dialog open onOpenChange={close}>
        <FormDialogContent size="md">
          <FormDialogHeader
            title={t(change.kind === "edit" ? "meetings.transcriptEditTitle" : "meetings.transcriptDeleteRangeTitle")}
            description={
              change.kind === "edit"
                ? t("meetings.transcriptEditDescription")
                : t("meetings.transcriptDeleteRangeDescription", { from: clock(change.segment.spoken_at) })
            }
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <FormDialogBody className="space-y-3">
              {change.kind === "edit" ? (
                <Field data-invalid={blank || undefined}>
                  <FieldLabel htmlFor={`${id}-text`}>{t("meetings.transcriptEditLabel")}</FieldLabel>
                  <Textarea
                    id={`${id}-text`}
                    value={text}
                    maxLength={4000}
                    rows={4}
                    aria-invalid={blank || undefined}
                    onChange={(e) => setText(e.target.value)}
                  />
                  {blank ? <FieldError>{t("meetings.transcriptEditEmpty")}</FieldError> : null}
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor={`${id}-end`}>{t("meetings.transcriptDeleteRangeEnd")}</FieldLabel>
                  <Select
                    id={`${id}-end`}
                    value={endId}
                    onValueChange={(next) => typeof next === "string" && setEndId(next)}
                    items={choices.map((s) => ({
                      value: s.id,
                      label: `${clock(s.spoken_at)} · ${speakerOf(s)} · ${s.text.slice(0, 60)}`,
                    }))}
                  />
                </Field>
              )}
              {failure}
            </FormDialogBody>
            <FormDialogFooter
              onCancel={() => close(false)}
              submitType="submit"
              submitLabel={t(change.kind === "edit" ? "common.save" : "meetings.transcriptDeleteConfirm")}
              submitting={pending}
              submitDisabled={blank}
            />
          </form>
        </FormDialogContent>
      </Dialog>
    );
  }

  const all = change.kind === "all";
  return (
    <ConfirmDialog
      open
      onOpenChange={close}
      title={t(all ? "meetings.transcriptDeleteAllTitle" : "meetings.transcriptDeleteLineTitle")}
      description={t(all ? "meetings.transcriptDeleteAllDescription" : "meetings.transcriptDeleteLineDescription")}
      confirmLabel={t("meetings.transcriptDeleteConfirm")}
      pending={pending}
      icon={Trash2}
      onConfirm={() => {
        // The dialog stays until the server answers; a failure says so and keeps it open.
        if (pending) return;
        remove.mutateAsync(all ? { all: true } : { segmentId: change.segment.id }).then(onClose, () => {
          toast.error(t("meetings.transcriptChangeFailed"));
        });
      }}
    />
  );
}

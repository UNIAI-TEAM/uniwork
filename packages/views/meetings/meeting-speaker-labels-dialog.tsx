"use client";
import { useState } from "react";
import { UserPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAssignSpeakerLabel, useSpeakerLabels } from "@uniwork/core/meetings/speaker-labels";
import type { SpeakerLabel } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastApiError } from "../toast-api-error";
import { MeetingAssigneeSelect } from "./meeting-assignee-select";
import { MeetingSectionError } from "./meeting-section-state";

/**
 * "Name speakers" (spec 2026-10-20-meeting-scribe-agent-design §4.3, §10): a
 * clerk gives each speaker the room microphone picked up to a member or a
 * free name. Shown only once there is a label to name.
 */
export function MeetingSpeakerLabelsButton({ meetingId, workspaceId }: { meetingId: string; workspaceId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labels = useSpeakerLabels(meetingId);
  if (!labels.data?.length) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <UserPen aria-hidden className="size-3.5" />
        {t("meetings.scribe.speakersButton")}
      </Button>
      <MeetingSpeakerLabelsDialog meetingId={meetingId} workspaceId={workspaceId} open={open} onOpenChange={setOpen} />
    </>
  );
}

export function MeetingSpeakerLabelsDialog({
  meetingId,
  workspaceId,
  open,
  onOpenChange,
}: {
  meetingId: string;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const labels = useSpeakerLabels(meetingId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("meetings.scribe.speakersTitle")}</DialogTitle>
          <DialogDescription>{t("meetings.scribe.speakersDescription")}</DialogDescription>
        </DialogHeader>
        {labels.isPending ? (
          <Spinner />
        ) : labels.isError ? (
          <MeetingSectionError message={t("meetings.scribe.speakersLoadFailed")} onRetry={() => void labels.refetch()} />
        ) : labels.data.length === 0 ? (
          <p className="text-label text-muted-foreground">{t("meetings.scribe.speakersEmpty")}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-4 overflow-y-auto">
            {labels.data.map((l) => (
              <SpeakerLabelRow key={l.id} meetingId={meetingId} workspaceId={workspaceId} label={l} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SpeakerLabelRow({ meetingId, workspaceId, label }: { meetingId: string; workspaceId: string; label: SpeakerLabel }) {
  const { t } = useTranslation();
  const assign = useAssignSpeakerLabel(meetingId);
  // A member and a free name exclude each other, as the server requires.
  const [userId, setUserId] = useState<string | undefined>(label.user_id || undefined);
  const [name, setName] = useState(label.name ?? "");
  const title = t("meetings.scribe.speakerLabel", { n: label.number ?? "?" });
  const save = () => {
    const free = name.trim();
    assign.mutateAsync({ labelId: label.id, user_id: userId, name: userId ? undefined : free || undefined }).then(
      () => toast.success(t("meetings.scribe.speakerSaved")),
      (err: unknown) => toastApiError(err, t("common.error")),
    );
  };
  return (
    <li className="space-y-2">
      <div>
        <p className="text-body font-medium text-foreground">{label.assigned_name || title}</p>
        {label.assigned_name ? <p className="text-caption text-muted-foreground">{title}</p> : null}
        {label.sample ? <p className="line-clamp-2 text-caption text-muted-foreground">“{label.sample}”</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MeetingAssigneeSelect
          workspaceId={workspaceId}
          value={userId}
          unassignedLabel={t("meetings.scribe.speakerNotAssigned")}
          className="w-44"
          onChange={(next) => {
            setUserId(next);
            if (next) setName("");
          }}
        />
        <Input
          value={name}
          maxLength={120}
          placeholder={t("meetings.scribe.speakerFreeName")}
          aria-label={`${title} · ${t("meetings.scribe.speakerFreeName")}`}
          className="h-8 w-44"
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value) setUserId(undefined);
          }}
        />
        <Button type="button" size="sm" disabled={assign.isPending} onClick={save}>
          {assign.isPending ? <Spinner /> : null}
          {t("meetings.scribe.speakerSave")}
        </Button>
      </div>
    </li>
  );
}

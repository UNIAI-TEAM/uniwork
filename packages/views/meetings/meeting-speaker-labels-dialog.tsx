"use client";
import { useState } from "react";
import { CircleAlert, UserPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAssignSpeakerLabel, useSpeakerLabels } from "@uniwork/core/meetings/speaker-labels";
import type { SpeakerLabel } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { apiErrorCopy } from "../api-error-copy";
import { MeetingAssigneeSelect } from "./meeting-assignee-select";
import { MeetingSectionError, MeetingSectionLoading } from "./meeting-section-state";

type Draft = { userId?: string; name: string };

const draftOf = (l: SpeakerLabel): Draft => ({ userId: l.user_id || undefined, name: l.name ?? "" });
const changed = (l: SpeakerLabel, d: Draft) => {
  const was = draftOf(l);
  return was.userId !== d.userId || was.name.trim() !== d.name.trim();
};

/** "Speaker n" of the room mic, or of an uploaded file (its key starts with "upload:"). */
function speakerTitle(label: SpeakerLabel, t: ReturnType<typeof useTranslation>["t"]): string {
  const n = label.number ?? "?";
  return label.label_key.startsWith("upload:") ? t("meetings.fileSpeaker", { n }) : t("meetings.scribe.speakerLabel", { n });
}

/**
 * "Name speakers" (spec 2026-10-20-meeting-scribe-agent-design §4.3, §10): a
 * clerk gives each speaker the room mic or an uploaded file picked up to a
 * member or a free name. Shown only once there is a label to name.
 */
export function MeetingSpeakerLabelsButton({ meetingId, workspaceId }: { meetingId: string; workspaceId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labels = useSpeakerLabels(meetingId);
  if (!labels.data?.length) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <UserPen aria-hidden />
        {t("meetings.scribe.speakersButton")}
      </Button>
      {open ? <MeetingSpeakerLabelsDialog meetingId={meetingId} workspaceId={workspaceId} open onOpenChange={setOpen} /> : null}
    </>
  );
}

/**
 * Every row is edited in place and saved together from the footer; a row the
 * server refused keeps its draft and says why, the others are saved.
 */
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
  const assign = useAssignSpeakerLabel(meetingId);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const rows = labels.data ?? [];
  const draft = (l: SpeakerLabel) => drafts[l.id] ?? draftOf(l);

  const save = async () => {
    if (saving) return;
    const dirty = rows.filter((l) => changed(l, draft(l)));
    if (dirty.length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const failed: Record<string, string> = {};
    for (const l of dirty) {
      const d = draft(l);
      try {
        // A member and a free name exclude each other, as the server requires.
        await assign.mutateAsync({ labelId: l.id, user_id: d.userId, name: d.userId ? undefined : d.name.trim() || undefined });
      } catch (err) {
        failed[l.id] = apiErrorCopy(err) ?? t("meetings.scribe.speakerSaveFailed");
      }
    }
    setSaving(false);
    setErrors(failed);
    if (Object.keys(failed).length === 0) {
      toast.success(t("meetings.scribe.speakerSaved"));
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (saving ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("meetings.scribe.speakersTitle")}</DialogTitle>
          <DialogDescription>{t("meetings.scribe.speakersDescription")}</DialogDescription>
        </DialogHeader>
        {labels.isPending ? (
          <MeetingSectionLoading label={t("meetings.scribe.speakersLoading")} className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-full" />
          </MeetingSectionLoading>
        ) : labels.isError ? (
          <MeetingSectionError message={t("meetings.scribe.speakersLoadFailed")} onRetry={() => void labels.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-label text-muted-foreground">{t("meetings.scribe.speakersEmpty")}</p>
        ) : (
          <ul className="max-h-[60vh] space-y-4 overflow-y-auto">
            {rows.map((l) => {
              const title = speakerTitle(l, t);
              const d = draft(l);
              const error = errors[l.id];
              const set = (next: Draft) => setDrafts((all) => ({ ...all, [l.id]: next }));
              return (
                <li key={l.id} className="space-y-2">
                  <div>
                    <p className="text-body font-medium text-foreground">{l.assigned_name || title}</p>
                    {l.assigned_name ? <p className="text-caption text-muted-foreground">{title}</p> : null}
                    {l.sample ? <p className="line-clamp-2 text-caption text-muted-foreground">{`"${l.sample}"`}</p> : null}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <MeetingAssigneeSelect
                      workspaceId={workspaceId}
                      value={d.userId}
                      unassignedLabel={t("meetings.scribe.speakerNotAssigned")}
                      className="w-full"
                      onChange={(next) => set({ userId: next, name: next ? "" : d.name })}
                    />
                    <Input
                      value={d.name}
                      maxLength={120}
                      placeholder={t("meetings.scribe.speakerFreeName")}
                      aria-label={`${title} · ${t("meetings.scribe.speakerFreeName")}`}
                      aria-invalid={error ? true : undefined}
                      onChange={(e) => set({ userId: e.target.value ? undefined : d.userId, name: e.target.value })}
                    />
                  </div>
                  {error ? (
                    <p role="alert" className="flex items-center gap-1.5 text-caption text-destructive">
                      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                      {error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            aria-disabled={saving || undefined}
            onClick={() => {
              if (!saving) onOpenChange(false);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button type="button" aria-disabled={saving || undefined} aria-busy={saving || undefined} onClick={() => void save()}>
            {saving ? <Spinner /> : null}
            {t("meetings.scribe.speakerSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";
import { useState } from "react";
import { Ban, CalendarDays, Pencil, PhoneOff, Play, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useAddNote,
  useCancelMeeting,
  useEndMeeting,
  useInvitations,
  useJoinRequests,
  useMeeting,
  useNotes,
  useParticipants,
  useStartMeeting,
} from "@uniwork/core/meetings";
import { paths } from "@uniwork/core/paths";
import { useMeetingPermissions } from "@uniwork/core/permissions";
import { useWorkspaceEvents } from "@uniwork/core/realtime";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { toast } from "sonner";
import { BreadcrumbHeader } from "../layout/breadcrumb-header";
import {
  CollectionPageHeaderAction,
  CollectionPageState,
} from "../layout/collection-page";
import { useWorkspace } from "../layout/workspace-context";
import { useNavigation } from "../navigation";
import { MeetingActivityTimeline } from "./meeting-activity-timeline";
import { formatMeetingRange, meetingLocale } from "./meeting-datetime";
import { MeetingPersonAvatar } from "./meeting-person";
import { MeetingEditDialog } from "./meeting-edit-dialog";
import { MeetingHostPanel } from "./host-panel";
import { MeetingParticipantsSection } from "./meeting-participants-section";
import { MeetingRsvpBar } from "./meeting-rsvp-bar";
import { MeetingStatusBadge } from "./meeting-status-badge";
import {
  MeetingCalendarButton,
  MeetingSummaryPanel,
} from "./meeting-summary-panel";

export function MeetingDetailView({
  workspaceId,
  meetingId,
  onJoin,
}: {
  workspaceId: string;
  meetingId: string;
  onJoin: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { workspace, user } = useWorkspace();
  const { push } = useNavigation();
  useWorkspaceEvents(workspaceId);
  const { data: meeting, isError } = useMeeting(meetingId);
  const { data: notes } = useNotes(meetingId);
  const { data: invitations } = useInvitations(meetingId);
  const { data: participants } = useParticipants(meetingId);
  const { data: joinRequests } = useJoinRequests(meetingId);
  const {
    canHost,
    canCancel,
    isLoading: permissionsLoading,
  } = useMeetingPermissions(meeting ?? null, workspaceId);
  const addNote = useAddNote(meetingId);
  const start = useStartMeeting(workspaceId);
  const end = useEndMeeting(workspaceId);
  const cancel = useCancelMeeting(workspaceId);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<"cancel" | "end" | null>(null);

  const meetingsHref = paths
    .workspace(workspace.organization_slug, workspace.slug)
    .meetings();
  const myParticipant = (participants ?? []).find((p) => p.user_id === user.id);
  const myInvite = (invitations ?? []).find(
    (inv) => inv.participant_id === myParticipant?.id,
  );
  const pendingJoins = (joinRequests ?? []).filter(
    (r) => r.status === "PENDING",
  ).length;

  if (isError) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbHeader
          segments={[{ href: meetingsHref, label: t("meetings.title") }]}
          leaf={t("meetings.notFound")}
        />
        <CollectionPageState
          icon={CalendarDays}
          role="alert"
          title={t("meetings.notFound")}
          description={t("meetings.notFoundHint")}
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => push(meetingsHref)}
            >
              {t("meetings.backToList")}
            </Button>
          }
        />
      </div>
    );
  }

  // Wait for the role too: otherwise the host sees the attendee layout for a frame.
  if (!meeting || permissionsLoading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbHeader
          segments={[{ href: meetingsHref, label: t("meetings.title") }]}
          leaf={t("common.loading")}
        />
        <div
          aria-hidden
          className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-6 p-4 sm:p-6"
        >
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-4 w-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  const scheduled = meeting.status === "SCHEDULED" || !meeting.status;
  const inProgress = meeting.status === "IN_PROGRESS";
  const closed = meeting.status === "ENDED" || meeting.status === "CANCELED";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BreadcrumbHeader
        segments={[{ href: meetingsHref, label: t("meetings.title") }]}
        leaf={meeting.title}
        actions={
          <>
            {canHost.allowed && scheduled ? (
              <CollectionPageHeaderAction
                icon={Play}
                label={t("meetings.start")}
                variant="outline"
                disabled={start.isPending}
                onClick={() =>
                  start.mutate(meetingId, {
                    onError: () => toast.error(t("common.error")),
                  })
                }
              />
            ) : null}
            {canHost.allowed && (scheduled || inProgress) ? (
              <MeetingEditDialog
                workspaceId={workspaceId}
                meeting={meeting}
                trigger={
                  <CollectionPageHeaderAction
                    icon={Pencil}
                    label={t("meetings.edit")}
                  />
                }
              />
            ) : null}
            {closed ? null : (
              <CollectionPageHeaderAction
                icon={Video}
                label={
                  canHost.allowed && pendingJoins > 0
                    ? `${t("meetings.join")} (${pendingJoins})`
                    : t("meetings.join")
                }
                variant="default"
                onClick={onJoin}
              />
            )}
            {canHost.allowed && inProgress ? (
              <CollectionPageHeaderAction
                icon={PhoneOff}
                label={t("meetings.end")}
                variant="outline"
                onClick={() => setConfirm("end")}
              />
            ) : null}
            {canCancel.allowed && scheduled ? (
              <CollectionPageHeaderAction
                icon={Ban}
                label={t("meetings.cancel")}
                variant="destructive"
                onClick={() => setConfirm("cancel")}
              />
            ) : null}
          </>
        }
      />
      <div className="mx-auto w-full min-w-0 max-w-2xl flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-pretty text-title font-semibold text-foreground">
            {meeting.title}
          </h1>
          <MeetingStatusBadge status={meeting.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-label tabular-nums text-muted-foreground">
            {/* Viewer's clock, same as the list; the stored zone only seeds the edit form. */}
            {formatMeetingRange(
              meeting.starts_at,
              meeting.ends_at,
              undefined,
              meetingLocale(i18n.language),
            )}
          </p>
          {closed ? null : <MeetingCalendarButton meetingId={meetingId} />}
        </div>
        {meeting.description ? (
          <p className="mt-3 whitespace-pre-wrap break-words text-pretty text-body text-foreground">
            {meeting.description}
          </p>
        ) : null}
        {myInvite ? (
          <MeetingRsvpBar meetingId={meetingId} invitation={myInvite} />
        ) : null}
        {canHost.allowed ? (
          <MeetingHostPanel
            workspaceId={workspaceId}
            meeting={meeting}
            invitations={invitations ?? []}
          />
        ) : (
          <MeetingParticipantsSection
            workspaceId={workspaceId}
            meeting={meeting}
            invitations={invitations ?? []}
            canManage={false}
          />
        )}
        {inProgress || meeting.status === "ENDED" ? (
          <MeetingSummaryPanel
            workspaceId={workspaceId}
            meeting={meeting}
            canHost={canHost.allowed}
          />
        ) : null}
        <MeetingActivityTimeline
          workspaceId={workspaceId}
          meetingId={meetingId}
        />
        <h2 className="mb-2 mt-6 text-body font-semibold text-foreground">
          {t("meetings.notes")}
        </h2>
        <ul className="space-y-2">
          {(notes ?? []).map((n) => (
            <li
              key={n.id}
              className="flex gap-2.5 rounded-lg border border-border bg-surface p-3"
            >
              <MeetingPersonAvatar
                name={n.display_name ?? n.author_id}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-caption font-medium text-muted-foreground">
                  {n.display_name ?? n.author_id}
                </div>
                <div className="whitespace-pre-wrap break-words text-body text-foreground">
                  {n.body}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {(notes ?? []).length === 0 ? (
          <p className="text-label text-muted-foreground">
            {t("meetings.notesEmpty")}
          </p>
        ) : null}
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim())
              addNote.mutate(note, {
                onSuccess: () => setNote(""),
                onError: () => toast.error(t("common.error")),
              });
          }}
        >
          <Field>
            <FieldLabel htmlFor="meeting-note">
              {t("meetings.addNote")}
            </FieldLabel>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
              <Textarea
                id="meeting-note"
                rows={2}
                className="min-w-0 flex-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                type="submit"
                className="shrink-0"
                disabled={addNote.isPending || !note.trim()}
              >
                {t("common.save")}
              </Button>
            </div>
          </Field>
        </form>
      </div>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "end"
                ? t("meetings.endConfirmTitle")
                : t("meetings.cancelConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "end"
                ? t("meetings.endConfirm")
                : t("meetings.cancelConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.back")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "cancel" ? "destructive" : "default"}
              disabled={end.isPending || cancel.isPending}
              onClick={() => {
                if (confirm === "end") {
                  end.mutate(meetingId, {
                    onError: () => toast.error(t("common.error")),
                  });
                } else {
                  // The meeting still exists as CANCELED — stay here and let the badge change.
                  cancel.mutate(meetingId, {
                    onError: () => toast.error(t("common.error")),
                  });
                }
                setConfirm(null);
              }}
            >
              {confirm === "end"
                ? t("meetings.confirmEnd")
                : t("meetings.confirmCancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

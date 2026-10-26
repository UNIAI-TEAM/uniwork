"use client";
import { useMemo, useRef, useState, type MutableRefObject, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { inviteLinkStatus, useInvitations, useInviteLinks, useParticipants } from "@uniwork/core/meetings";
import { useAttendanceFinalized } from "@uniwork/core/meetings/attendance";
import { useMeetingMotions } from "@uniwork/core/meetings/motions";
import type { Meeting, MeetingParticipant } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@uniwork/ui/components/ui/sheet";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { browserTimeZone } from "../meeting-schedule-fields";
import { useNow } from "../use-now";
import { CarriedOverBlock, seriesShortTitle, usePreviousQuestions } from "./carried-over-block";
import { draftFromMeeting, emptyDraft, type MeetingDraft } from "./draft-model";
import { followUpDraft } from "./follow-up-draft";
import type { Rsvp } from "./person-role-row";
import { SheetEditor, type EditorSetup } from "./sheet-editor";

export type MeetingSheetProps = {
  workspaceId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactElement;
  showTrigger?: boolean;
  /** Called with the meeting's id once created (create / follow-up); omitted where the caller stays put. */
  onDone?: (meetingId: string) => void;
} & (
  | {
      mode: "create";
      initialDraft?: Partial<MeetingDraft>;
      /** The quick card's Idempotency-Key, when it hands its draft over. */
      idempotencyKey?: string;
    }
  | { mode: "followUp"; previous: Meeting; previousParticipants: readonly MeetingParticipant[] }
  | { mode: "edit"; meeting: Meeting }
);

/** The kit scrim instead of the primitive's faint blur. */
const SCRIM = "bg-scrim supports-backdrop-filter:backdrop-blur-none";

/**
 * The one meeting sheet (create brief §2.1, create-ui §2): a 560 right sheet
 * — a full-screen page on a phone — for Tạo cuộc họp, Lên lịch họp tiếp theo
 * and Sửa cuộc họp, opened from its trigger or controlled. Every close goes
 * through the open editor's `requestClose()`.
 */
export function MeetingSheet(props: MeetingSheetProps) {
  const { t } = useTranslation();
  const { open: openProp, onOpenChange, trigger, showTrigger = true, workspaceId, onDone } = props;
  const [ownOpen, setOwnOpen] = useState(false);
  const [resumeRun, setResumeRun] = useState<string | null>(null);
  const guard = useRef<(() => void) | null>(null);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
    if (!next) {
      guard.current = null;
      setResumeRun(null);
    }
  };
  const defaultTrigger =
    props.mode === "edit" ? (
      <Button size="sm" variant="outline">
        {t("meetings.edit")}
      </Button>
    ) : (
      <Button size="sm">{t("meetings.new")}</Button>
    );
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else if (guard.current) guard.current();
        else setOpen(false);
      }}
    >
      {showTrigger ? <SheetTrigger render={trigger ?? defaultTrigger} /> : null}
      <SheetContent
        side="right"
        showCloseButton={false}
        overlayClassName={SCRIM}
        className="gap-0 rounded-l-lg border-border bg-popover p-0 data-[side=right]:w-140 data-[side=right]:max-w-full data-[side=right]:sm:max-w-none max-sm:rounded-none max-sm:border-l-0 max-sm:data-[side=right]:w-full"
      >
        {open ? (
          <SheetBody
            {...props}
            guardRef={guard}
            onClose={() => setOpen(false)}
            onDone={onDone}
            workspaceId={workspaceId}
            resumeRun={resumeRun}
            onReopen={(runId) => {
              setResumeRun(runId);
              setOpen(true);
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

type BodyProps = MeetingSheetProps & {
  guardRef: MutableRefObject<(() => void) | null>;
  onClose: () => void;
  resumeRun: string | null;
  onReopen: (runId: string) => void;
};

function SheetBody(props: BodyProps) {
  if (props.mode === "edit") return <EditBody {...props} meeting={props.meeting} />;
  if (props.mode === "followUp") return <FollowUpBody {...props} previous={props.previous} previousParticipants={props.previousParticipants} />;
  return <CreateBody {...props} initialDraft={props.initialDraft} idempotencyKey={props.idempotencyKey} />;
}

function editorProps(p: BodyProps) {
  return { workspaceId: p.workspaceId, guardRef: p.guardRef, onClose: p.onClose, onDone: p.onDone, initialRunId: p.resumeRun, onReopen: p.onReopen };
}

function CreateBody(p: BodyProps & { initialDraft?: Partial<MeetingDraft>; idempotencyKey?: string }) {
  const nowMs = useNow();
  const [{ initial, baseline }] = useState(() => {
    const empty = emptyDraft(nowMs, browserTimeZone());
    const initial: MeetingDraft = { ...empty, ...p.initialDraft };
    // The prefill's time is where the sheet starts; anything else in it (the quick card's title, people) was typed.
    const { date, start, end, timezone } = initial;
    return { initial, baseline: { ...empty, date, start, end, timezone } };
  });
  return <SheetEditor {...editorProps(p)} setup={{ mode: "create", initial, baseline, idempotencyKey: p.idempotencyKey }} />;
}

function FollowUpBody(p: BodyProps & { previous: Meeting; previousParticipants: readonly MeetingParticipant[] }) {
  const { t } = useTranslation();
  const nowMs = useNow();
  const [{ draft, swap }] = useState(() => followUpDraft(p.previous, p.previousParticipants, nowMs, browserTimeZone()));
  const questions = usePreviousQuestions(p.previous).map((q) => q.text);
  const label = swap ? t("meetings.sheet.weekLabel", { week: swap.from }) : seriesShortTitle(p.previous.title);
  const setup: EditorSetup = {
    mode: "followUp",
    initial: draft,
    previous: p.previous,
    swap,
    previousLabel: label,
    previousSecretaryId: p.previousParticipants.find((x) => x.is_secretary && x.status === "ACTIVE")?.user_id,
    questions,
    carried: (
      <CarriedOverBlock
        workspaceId={p.workspaceId}
        previous={p.previous}
        nowMs={nowMs}
        previousLabel={label}
        onReviewFirst={() => p.guardRef.current?.()}
      />
    ),
  };
  return <SheetEditor {...editorProps(p)} setup={setup} />;
}

/** What changes when someone else saves: the server version, or the fields themselves. */
function revisionOf(m: Meeting): string {
  if (m.version !== undefined) return String(m.version);
  return JSON.stringify([m.title, m.description, m.starts_at, m.ends_at, m.timezone, m.allow_join_request, m.status, m.quorum_percent, m.project_id]);
}

function EditBody(p: BodyProps & { meeting: Meeting }) {
  const { t } = useTranslation();
  const { meeting } = p;
  const participants = useParticipants(meeting.id);
  const motions = useMeetingMotions(meeting.id);
  const links = useInviteLinks(meeting.id);
  const nowMs = useNow();
  // Revoked and expired links stay in the list response; the sheet counts and shows live ones only.
  const activeLinks = useMemo(() => (links.data ?? []).filter((l) => inviteLinkStatus(l, new Date(nowMs)) === "active"), [links.data, nowMs]);
  const invitations = useInvitations(meeting.id);
  const quorumLocked = useAttendanceFinalized(meeting.id, true);
  const [seedRevision, setSeedRevision] = useState(() => revisionOf(meeting));
  const rsvp = useMemo(() => {
    const byParticipant = new Map((invitations.data ?? []).map((i) => [i.participant_id, i.response_status]));
    const out = new Map<string, Rsvp>();
    for (const x of participants.data ?? []) {
      const status = byParticipant.get(x.id);
      if (!x.user_id || !status) continue;
      out.set(x.user_id, status === "ACCEPTED" ? "yes" : status === "DECLINED" ? "no" : "wait");
    }
    return out;
  }, [invitations.data, participants.data]);
  if (participants.isPending || motions.isPending) {
    return (
      <div className="grid h-full place-items-center">
        <SheetTitle className="sr-only">{t("meetings.edit")}</SheetTitle>
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }
  const seed = () => draftFromMeeting(meeting, participants.data ?? [], motions.data ?? [], browserTimeZone());
  const setup: EditorSetup = {
    mode: "edit",
    initial: seed(),
    meeting,
    existingLinks: activeLinks,
    rsvp,
    quorumLocked,
    removedUserIds: new Set((participants.data ?? []).flatMap((x) => (x.status === "REMOVED" && x.user_id ? [x.user_id] : []))),
    stale: seedRevision !== revisionOf(meeting),
    reseed: () => {
      setSeedRevision(revisionOf(meeting));
      return seed();
    },
  };
  return <SheetEditor {...editorProps(p)} setup={setup} />;
}

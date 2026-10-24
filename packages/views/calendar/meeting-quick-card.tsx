"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Clock, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode } from "@uniwork/core/api/http";
import { useAuthStore } from "@uniwork/core/auth";
import { calendarKeys } from "@uniwork/core/calendar";
import { meetingKeys, useMeetingCapabilities } from "@uniwork/core/meetings";
import { useMembers } from "@uniwork/core/workspaces";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent } from "@uniwork/ui/components/ui/popover";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { apiErrorCopy } from "../api-error-copy";
import { scheduleWindowIso } from "../meetings/meeting-datetime";
import { meetingAvatarTint } from "../meetings/meeting-detail/avatar-tint";
import { clockRange, durationWords, longDay } from "../meetings/meeting-detail/format";
import { AvatarStack } from "../meetings/meeting-detail/ui/avatar-stack";
import { kitButton } from "../meetings/meeting-detail/ui/kit-buttons";
import { TextButton } from "../meetings/meeting-detail/ui/text-button";
import type { MeetingDraft } from "../meetings/meeting-sheet/draft-model";
import { durationMinutes, validateDraft } from "../meetings/meeting-sheet/draft-validation";
import { PeopleSearch } from "../meetings/meeting-sheet/people-field";
import {
  dropRun,
  isHttpFailure,
  retryRows,
  runRows,
  startSubmitRun,
  useSubmitRun,
  type SubmitRun,
} from "../meetings/meeting-sheet/run-submit-plan";
import { scribeAvailability, scribePolicyDefault } from "../meetings/meeting-sheet/scribe-block";
import { buildCreatePlan } from "../meetings/meeting-sheet/submit-plan";
import { TimeRow } from "../meetings/meeting-sheet/time-row";
import { useNow } from "../meetings/use-now";
import { ScribeGlyph } from "@uniwork/ui/brand/scribe-mark";

type Anchor = Element | { getBoundingClientRect: () => DOMRect; contextElement?: Element };

const pad = (n: number) => String(n).padStart(2, "0");

/** The screen y of a wall time on the week grid (FullCalendar's 30-minute lanes), or null off the grid. */
function laneY(time: string): number | null {
  const [h = 0, m = 0] = time.split(":").map(Number);
  const base = m >= 30 ? 30 : 0;
  const lane = document.querySelector(`.uniwork-fc .fc-timegrid-slot-lane[data-time="${pad(h)}:${pad(base)}:00"]`);
  if (!lane) return null;
  const r = lane.getBoundingClientRect();
  return r.top + ((m - base) / 30) * r.height;
}

/**
 * The card hangs under the slot it creates (board CreateFromSlot): the day's
 * column and the start/end lanes, measured live so a scrolled grid keeps it
 * in place. Month view, or a grid that is not there, falls back to `fallback`.
 */
function slotAnchor(draft: Pick<MeetingDraft, "date" | "start" | "end">, fallback: Element | null): Anchor | null {
  const column = () => document.querySelector(`.uniwork-fc .fc-timegrid-col[data-date="${draft.date}"]`);
  if (!column()) return fallback;
  return {
    contextElement: column() ?? undefined,
    getBoundingClientRect: () => {
      const col = column()?.getBoundingClientRect();
      const top = laneY(draft.start);
      if (!col || top === null) return fallback?.getBoundingClientRect() ?? new DOMRect();
      const end = draft.end > draft.start ? laneY(draft.end) : null;
      const bottom = end ?? top + 48;
      // Phone: the card spans the screen 8 from each edge (board CreateFromSlot at 390), so its anchor does too.
      if (window.innerWidth < 600) return new DOMRect(8, top, window.innerWidth - 16, bottom - top);
      return new DOMRect(col.left + 3, top, col.width - 9, bottom - top);
    },
  };
}

/** Kit toast actions (board CreateFromSlot): link-ink text buttons instead of sonner's filled chips. */
const TEXT_ACTIONS = {
  actionButton: "bg-transparent! px-1.5! text-body! font-medium! text-primary! hover:underline!",
  cancelButton: "bg-transparent! px-1.5! text-body! font-medium! text-primary! hover:underline!",
};

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.random()}`;

/**
 * The calendar's quick card (create brief §2.12, §3.6; board CreateFromSlot):
 * a 400 popover under the slot with the time line (a button that opens the
 * time row in place), the title, the people search and the scribe default.
 * [Tạo cuộc họp] (or ⌘↵) creates through the sheet's submit plan and keeps
 * the person on the calendar with a toast; [Thêm tùy chọn] hands the exact
 * draft, and the card's Idempotency-Key, to the full sheet. Non-modal (AUDIT L1): Esc, × and a click outside
 * close it without asking (AB-11), except while the create call runs.
 */
export function MeetingQuickCard({
  workspaceId,
  initial,
  anchor,
  onClose,
  onMoreOptions,
  onOpenMeeting,
}: {
  workspaceId: string;
  initial: MeetingDraft;
  anchor: Element | null;
  onClose: () => void;
  onMoreOptions: (draft: MeetingDraft, idempotencyKey: string) => void;
  onOpenMeeting: (meetingId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId().replace(/:/g, "");
  const qc = useQueryClient();
  const nowMs = useNow(30_000);
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const { data: members = [], isPending: membersPending, isError: membersError, refetch: refetchMembers } = useMembers(workspaceId);
  const [draft, setDraft] = useState(initial);
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeCommitted, setTimeCommitted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  // One key per card: a create resent after a lost answer, here or from the sheet, never makes a second meeting.
  const [idempotencyKey] = useState(newKey);
  const run = useSubmitRun(runId);
  const attached = useRef(true);
  useEffect(() => {
    attached.current = true;
    return () => {
      attached.current = false;
    };
  }, []);
  const [cardAnchor] = useState(() => slotAnchor(initial, anchor));

  const busy = Boolean(run && run.phase !== "done" && !run.phase1Error);
  const titleIssue = submitted && !draft.title.trim();
  const patch = (next: Partial<MeetingDraft>) => setDraft((d) => ({ ...d, ...next }));
  const nameOf = (userId: string) => members.find((m) => m.user_id === userId)?.display_name ?? t("meetings.formerMember");
  const chosen = useMemo(() => new Set(draft.people.map((p) => p.userId)), [draft.people]);
  const userId = useAuthStore((s) => s.user?.id);
  // The creator hosts, so the search offers everyone else.
  const exclude = useMemo(() => new Set([...(userId ? [userId] : []), ...chosen]), [userId, chosen]);

  const slot = scheduleWindowIso(draft.date, draft.start, draft.end, draft.timezone);
  const minutes = durationMinutes(draft.start, draft.end);
  const day = longDay(slot.starts_at, nowMs, t, draft.timezone);
  const duration = durationWords(minutes, t);
  const availability = scribeAvailability(caps);
  const scribeOn = availability === "on" && scribePolicyDefault(caps);

  const invalidate = (meetingId: string) => {
    for (const key of [meetingKeys.list(workspaceId), meetingKeys.stats(workspaceId), meetingKeys.detail(meetingId), meetingKeys.participants(meetingId), meetingKeys.invitations(meetingId)]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  /** Focus the new block once the calendar has it (AUDIT S12), so a keyboard user keeps their place. */
  const focusNewEvent = async (title: string) => {
    await qc.refetchQueries({ queryKey: calendarKeys.all(workspaceId) });
    requestAnimationFrame(() => {
      // shortcut: found by its title text, since the grid's events carry no id in the DOM; fine until two blocks share a title.
      const block = [...document.querySelectorAll<HTMLElement>(".uniwork-fc .fc-event")].find((el) => el.textContent?.includes(title));
      if (!block) return;
      if (block.tabIndex < 0) block.tabIndex = -1;
      block.focus();
    });
  };

  const openAction = (meetingId: string) => ({
    label: <span aria-label={t("calendar.quickCard.openAria")}>{t("meetings.sheet.open")}</span>,
    onClick: () => onOpenMeeting(meetingId),
  });

  const finish = (done: SubmitRun) => {
    if (done.phase1Error) {
      // Still open: the line above the foot says it. Closed while slow: only a toast can.
      if (!attached.current) toast.error(failureLine(done.phase1Error, t), { position: "bottom-center" });
      return;
    }
    const meetingId = done.meetingId!;
    const wasOpen = attached.current;
    if (wasOpen) onClose();
    const people = runRows(done).find((r) => r.key === "people");
    const failed = people?.steps.flatMap((s) => (s.state.status === "failed" && s.step.kind === "invite" ? [nameOf(s.step.userId)] : [])) ?? [];
    if (failed.length) {
      // No result panel on the calendar (AUDIT ERR-13 / S11): the toast stays until answered.
      toast.warning(t("calendar.quickCard.inviteFailed", { names: failed.join(", ") }), {
        position: "bottom-center",
        duration: Infinity,
        classNames: TEXT_ACTIONS,
        action: { label: t("calendar.quickCard.reinvite"), onClick: () => void retryRows(done.id, ["people"]) },
        cancel: openAction(meetingId),
      });
    } else {
      dropRun(done.id);
      toast.success(t("meetings.created"), { position: "bottom-center", duration: 8000, classNames: TEXT_ACTIONS, action: openAction(meetingId) });
    }
    if (wasOpen) void focusNewEvent(done.meeting?.title ?? draft.title.trim());
  };

  const submit = () => {
    if (busy) return;
    if (validateDraft(draft, { nowMs: Date.now(), checkPast: true }).length) {
      setSubmitted(true);
      if (!draft.title.trim()) document.getElementById(`${id}-title`)?.focus();
      else {
        setTimeOpen(true);
        setTimeCommitted(true);
      }
      return;
    }
    if (run) dropRun(run.id);
    const plan = buildCreatePlan(draft, {
      scribeDefault: scribePolicyDefault(caps),
      scribeOffered: availability === "on",
      defaultLinkName: "",
    });
    setRunId(startSubmitRun(plan, { workspaceId, idempotencyKey, invalidate, onDone: finish }));
  };

  const requestClose = () => {
    if (busy && !run?.slow) return;
    onClose();
  };

  return (
    <Popover open onOpenChange={(next) => !next && requestClose()}>
      <PopoverContent
        anchor={cardAnchor ?? undefined}
        side="bottom"
        align="start"
        sideOffset={8}
        initialFocus={() => document.getElementById(`${id}-title`)}
        aria-labelledby={`${id}-heading`}
        className="block w-100 max-w-[calc(100vw-16px)] gap-0 rounded-lg border border-border bg-popover p-4 pt-3 shadow-[var(--menu-shadow),var(--floating-shadow)] ring-0"
      >
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- ⌘↵ submits from any field inside the card. */}
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
            // A plain Enter in the people search picks a person or nothing; it never creates the meeting.
            if (!(e.metaKey || e.ctrlKey)) {
              if ((e.target as HTMLElement).getAttribute("role") === "combobox") e.preventDefault();
              return;
            }
            e.preventDefault();
            submit();
          }}
        >
          <h2 id={`${id}-heading`} className="sr-only">
            {t("meetings.new")}
          </h2>
          {/* 32 tall like the kit row: on a touch screen the 44 close target overhangs it instead of pushing the card down. */}
          <div className="-mr-2 flex h-8 items-center justify-between gap-2">
            <button
              type="button"
              aria-expanded={timeOpen}
              aria-label={t("calendar.quickCard.whenAria", { day, from: draft.start, to: draft.end, duration })}
              onClick={() => setTimeOpen((o) => !o)}
              className="-ml-2 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-label font-medium text-foreground tabular-nums hover:bg-surface-hover pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 relative"
            >
              <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                <Trans
                  t={t}
                  i18nKey="calendar.quickCard.when"
                  values={{ day, range: clockRange(slot.starts_at, slot.ends_at, draft.timezone), duration }}
                  components={{ time: <time /> }}
                />
              </span>
              <ChevronDown aria-hidden className={cn("size-3 shrink-0 text-muted-foreground transition-transform", timeOpen && "rotate-180")} />
            </button>
            <Button type="button" variant="ghost" size="icon-sm" className={cn(kitButton.icon, "pointer-coarse:-mr-2")} aria-label={t("common.close")} onClick={requestClose}>
              <X aria-hidden />
            </Button>
          </div>
          {timeOpen ? (
            <TimeRow
              idPrefix={id}
              label={false}
              // The card is 400 wide: the day takes its own line, the hours go under it.
              className="mt-2 [&>div:first-child]:flex-wrap [&>div:first-child>:first-child]:w-full"
              value={draft}
              onChange={patch}
              nowMs={nowMs}
              checkPast
              revealPast={timeCommitted || submitted}
              onCommit={() => setTimeCommitted(true)}
              readOnly={busy}
            />
          ) : null}
          <label htmlFor={`${id}-title`} className="sr-only">
            {t("meetings.meetingTitle")}
          </label>
          <input
            id={`${id}-title`}
            required
            autoComplete="off"
            value={draft.title}
            readOnly={busy}
            aria-readonly={busy || undefined}
            aria-invalid={titleIssue || undefined}
            aria-describedby={titleIssue ? `${id}-title-error` : undefined}
            placeholder={t("meetings.sheet.titlePlaceholder")}
            onChange={(e) => patch({ title: e.target.value })}
            className={cn(
              "mt-2 block h-10.25 w-full border-0 border-b border-border bg-transparent pl-0.75 text-body-lg text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:shadow-[0_1px_0_var(--ring)]",
              titleIssue && "border-destructive focus-visible:border-destructive focus-visible:shadow-[0_1px_0_var(--destructive)]",
            )}
          />
          {titleIssue ? (
            <p id={`${id}-title-error`} className="mt-1.5 flex items-center gap-1.5 text-caption text-destructive">
              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
              {t("meetings.titleRequired")}
            </p>
          ) : null}
          <span id={`${id}-people-label`} className="sr-only">
            {t("meetings.attendees")}
          </span>
          <PeopleSearch
            id={`${id}-people`}
            labelledBy={`${id}-people-label`}
            // Kit `.qc-field` stays 36 on a phone too (the sheet's control grows to 44 there).
            className="mt-4 max-sm:[&>div:first-child]:h-9"
            members={members}
            exclude={exclude}
            onPick={(userId) => patch({ people: [...draft.people, { userId, role: "MEMBER" }] })}
            loadState={membersPending ? "pending" : membersError ? "error" : "ready"}
            onRetry={() => void refetchMembers()}
            readOnly={busy}
          />
          {draft.people.length ? (
            <div className="mt-2 flex items-center gap-2">
              <AvatarStack
                people={draft.people.map((p) => ({ id: p.userId, name: nameOf(p.userId), tint: meetingAvatarTint(p.userId, members) }))}
              />
              <p className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
                {t("meetings.sheet.willBeInvited", { names: draft.people.map((p) => nameOf(p.userId)).join(", ") })}
              </p>
              <TextButton aria-label={t("calendar.quickCard.clearPeopleAria")} aria-disabled={busy || undefined} onClick={() => patch({ people: [] })}>
                {t("calendar.quickCard.clearPeople")}
              </TextButton>
            </div>
          ) : null}
          {availability !== "hidden" ? (
            <p className="mt-3 flex items-center gap-1.5 text-caption text-muted-foreground">
              <ScribeGlyph className="size-3" />
              <span>{t("calendar.quickCard.scribe", { state: t(scribeOn ? "meetings.sheet.on" : "meetings.sheet.off") })}</span>
            </p>
          ) : null}
          {run?.phase1Error ? (
            <p role="alert" className="mt-3 flex items-start gap-1.5 text-caption text-destructive">
              <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              {failureLine(run.phase1Error, t)}
            </p>
          ) : run?.slow ? (
            <p role="status" className="mt-3 text-caption text-muted-foreground">
              {t("meetings.sheet.slow")}
            </p>
          ) : null}
          <div className="mt-4 flex h-9 items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="lg"
              aria-haspopup="dialog"
              aria-disabled={busy || undefined}
              className={cn(kitButton.base, kitButton.ghost, "-ml-3.5")}
              onClick={() => !busy && onMoreOptions(draft, idempotencyKey)}
            >
              {t("meetings.sheet.more")}
            </Button>
            <Button
              type="submit"
              variant="brand"
              size="lg"
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className={cn(kitButton.base, "aria-disabled:opacity-100")}
            >
              {busy ? <Spinner className="size-3.5" /> : null}
              {t(busy ? "meetings.creating" : "meetings.createSubmit")}
              {busy ? null : (
                <kbd aria-hidden className="font-sans text-caption font-normal opacity-85 max-sm:hidden">
                  {t("meetings.sheet.kbdSubmit")}
                </kbd>
              )}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function failureLine(err: unknown, t: ReturnType<typeof useTranslation>["t"]): string {
  if (errorCode(err) === "idempotency_payload_mismatch") return t("meetings.sheet.createMismatch");
  if (!isHttpFailure(err)) return t("meetings.sheet.unknownOutcome");
  return t("meetings.sheet.createFailed", { reason: apiErrorCopy(err) ?? t("common.error") });
}

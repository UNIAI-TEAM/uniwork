"use client";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  motionVoterCount,
  useFinalizeAttendance,
  useMarkAttendance,
  useMeetingAttendance,
  useReopenAttendance,
} from "@uniwork/core/meetings/attendance";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type MeetingAttendanceRow } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { cn } from "@uniwork/ui/lib/utils";
import { toastApiError } from "../../../toast-api-error";
import { MeetingRowsSkeleton, MeetingSectionError } from "../../meeting-section-state";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { Dialog440, SideSheet } from "../ui/overlay";
import { RollRow } from "./roll-row";

/** Above this many people the roll gets a search field (brief §2.6). */
const SEARCH_FROM = 9;

type Group = { key: string; label: string; rows: MeetingAttendanceRow[] };

/** From this viewport width the roll docks over the rail instead of covering the page (LiveSecretary). */
const DOCK_QUERY = "(min-width: 1400px)";

function subscribeDock(onChange: () => void) {
  const query = window.matchMedia(DOCK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The live roll (kit `.drawer` 480, LiveSecretary): who is in the online room,
 * members grouped by status with counts, a status select per row for whoever
 * clerks, observers and late additions apart, and [Chốt điểm danh] (or
 * [Mở lại]) behind a confirmation. The rail's Điểm danh row opens it; Esc
 * closes it and focus goes back there. On a wide window it is a non-modal
 * panel docked in the page's frame, so the notes stay usable beside it; below
 * that, a drawer over a scrim.
 */
export function RollDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { meeting, layout } = useDetail();
  const { data } = useMeetingAttendance(meeting.id, open);
  const wide = useSyncExternalStore(subscribeDock, () => window.matchMedia(DOCK_QUERY).matches, () => false);
  const title = data ? t("meetings.detail.roll.title", { count: data.rows.length }) : t("meetings.governance.attendanceTitle");
  const footer = data ? <RollFooter /> : undefined;
  if (wide && layout === "page") {
    return (
      <DockedPanel open={open} onOpenChange={onOpenChange} title={title} footer={footer}>
        <RollBody />
      </DockedPanel>
    );
  }
  return (
    <SideSheet open={open} onOpenChange={onOpenChange} width={480} title={title} footer={footer}>
      <RollBody />
    </SideSheet>
  );
}

/** The page scroller's box, kept current while `on`: the frame the docked panel sits in. */
function useFrameRect(anchor: HTMLElement | null, on: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    // shortcut: finds the scroller through the page's content test id; upgrade when the page exposes a frame ref.
    const frame = anchor?.closest("[data-testid='meeting-detail-content']")?.parentElement;
    if (!on || !frame) return;
    const measure = () => setRect(frame.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [anchor, on]);
  return rect;
}

/**
 * Kit `.roll` at ≥ 1400: the drawer's head, body and foot (as `SideSheet`
 * draws them), fixed over the right of the page frame below the breadcrumb,
 * with no scrim, no focus trap and no close on an outside click.
 */
function DockedPanel({
  open,
  onOpenChange,
  title,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const rect = useFrameRect(anchor, open);
  // The page reflows beside the docked panel (kit `.page.has-panel`); its parts key their spacing on this.
  useEffect(() => {
    const content = anchor?.closest<HTMLElement>("[data-testid='meeting-detail-content']");
    if (!open || !content) return;
    content.dataset.panel = "roll";
    return () => {
      delete content.dataset.panel;
    };
  }, [anchor, open]);
  const style = rect
    ? { top: rect.top, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom, height: "auto" }
    : undefined;
  return (
    <>
      <span ref={setAnchor} hidden />
      <Sheet open={open} onOpenChange={onOpenChange} modal={false} disablePointerDismissal>
        <SheetContent
          side="right"
          showCloseButton={false}
          overlayClassName="hidden"
          style={style}
          className="gap-0 rounded-none rounded-br-lg border-border bg-popover p-0 shadow-menu data-[side=right]:w-120 data-[side=right]:max-w-full data-[side=right]:sm:max-w-none"
        >
          <div className="flex flex-none items-center justify-between gap-3 border-b border-border py-4 pr-4 pl-6">
            <SheetTitle className="min-w-0 text-title-sm font-semibold text-balance">{title}</SheetTitle>
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(kitButton.icon, "size-9")}
              aria-label={t("common.close")}
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">{children}</div>
          {footer ? (
            <div className="flex flex-none items-center justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function RollBody() {
  const { t, i18n } = useTranslation();
  const { meeting, isClerk } = useDetail();
  const { data, isPending, isError, refetch } = useMeetingAttendance(meeting.id);
  const mark = useMarkAttendance(meeting.id);
  const [query, setQuery] = useState("");
  if (isPending) return <MeetingRowsSkeleton rows={4} className="py-1" />;
  if (isError || !data) {
    return <MeetingSectionError message={t("meetings.governance.loadFailed")} onRetry={() => void refetch()} />;
  }
  const finalized = Boolean(data.finalized_at);
  const needle = query.trim().toLocaleLowerCase(i18n.language);
  const shown = needle
    ? data.rows.filter((r) => r.display_name.toLocaleLowerCase(i18n.language).includes(needle))
    : data.rows;
  const later = finalized ? shown.filter((r) => r.joined_after_finalize) : [];
  const onRoll = shown.filter((r) => !later.includes(r));
  const members = onRoll.filter((r) => r.standing === "MEMBER");
  const groups: Group[] = [
    ...ATTENDANCE_STATUSES.map((s) => ({
      key: s,
      label: t(`meetings.detail.roll.status_${s}`),
      rows: members.filter((r) => (ATTENDANCE_STATUSES.includes(r.status as AttendanceStatus) ? r.status : "ABSENT") === s),
    })),
    { key: "observers", label: t("meetings.detail.roll.observers"), rows: onRoll.filter((r) => r.standing !== "MEMBER") },
    { key: "later", label: t("meetings.detail.roll.addedLater"), rows: later },
  ].filter((g) => g.rows.length > 0);
  const inRoom = data.rows.filter((r) => r.in_room).length;
  const onMark = (row: MeetingAttendanceRow, status: AttendanceStatus, note?: string) =>
    mark.mutateAsync({ participantId: row.participant_id, status, note }).catch((err: unknown) => {
      toastApiError(err, t("common.error"));
      throw err;
    });

  return (
    <>
      <p className="flex min-h-5 items-start gap-2 pb-1 text-muted-foreground">
        <Video aria-hidden className="mt-0.5 size-4 flex-none" />
        <span className="text-caption">
          {inRoom > 0 ? t("meetings.detail.roll.inRoom", { count: inRoom }) : t("meetings.detail.roll.nobodyInRoom")}
        </span>
      </p>
      {data.rows.length >= SEARCH_FROM ? (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("meetings.detail.roll.search")}
          placeholder={t("meetings.detail.roll.search")}
          className="mt-3 h-9"
        />
      ) : null}
      {groups.length === 0 && needle ? (
        <p className="py-4 text-caption text-muted-foreground">{t("meetings.detail.roll.noMatch")}</p>
      ) : null}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className="flex items-baseline gap-2 pt-4 pb-1">
            <h3 className="text-caption font-medium text-muted-foreground">{group.label}</h3>
            <span className="text-caption text-muted-foreground tabular-nums">{group.rows.length}</span>
          </div>
          <ul className="[&>li+li]:border-t [&>li+li]:border-border">
            {group.rows.map((row) => (
              <RollRow
                key={row.participant_id}
                row={row}
                isHost={Boolean(row.user_id) && row.user_id === meeting.host_user_id}
                editable={isClerk && !finalized && group.key !== "later"}
                onMark={(status, note) => onMark(row, status, note)}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function RollFooter() {
  const { t } = useTranslation();
  const { meeting, isClerk } = useDetail();
  const { data } = useMeetingAttendance(meeting.id);
  const finalize = useFinalizeAttendance(meeting.id);
  const reopen = useReopenAttendance(meeting.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!data) return null;
  const finalized = Boolean(data.finalized_at);
  const action = finalized ? reopen : finalize;
  const run = () =>
    action.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(t(finalized ? "meetings.governance.reopenedToast" : "meetings.governance.finalizedToast"), {
          position: "bottom-center",
        });
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  const label = t(finalized ? "meetings.governance.reopen" : "meetings.governance.finalize");
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <p className="text-caption text-muted-foreground">
        {finalized && data.finalized_at
          ? t("meetings.detail.roll.finalizedAt", { time: clock(data.finalized_at) })
          : t("meetings.detail.roll.voters", {
              count: motionVoterCount(data),
              present: data.summary.present,
              late: data.summary.late,
            })}
      </p>
      {isClerk ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          aria-haspopup="dialog"
          className={cn(kitButton.base, kitButton.outline, "flex-none")}
          onClick={() => setConfirmOpen(true)}
        >
          {label}
        </Button>
      ) : null}
      <Dialog440
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        role="alertdialog"
        title={t(finalized ? "meetings.governance.reopenConfirmTitle" : "meetings.governance.finalizeConfirmTitle")}
        description={t(finalized ? "meetings.governance.reopenConfirm" : "meetings.governance.finalizeConfirm")}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className={cn(kitButton.base, kitButton.ghost)}
              onClick={() => setConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="brand"
              size="lg"
              className={kitButton.base}
              disabled={action.isPending}
              aria-busy={action.isPending || undefined}
              onClick={run}
            >
              {label}
            </Button>
          </>
        }
      />
    </div>
  );
}

"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type MeetingAttendanceRow } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ATTENDANCE_DOT, ATTENDANCE_TONE, asAttendanceStatus } from "./meeting-attendance-status";
import { MeetingPersonAvatar } from "./meeting-person";
import { ToneBadge } from "./meeting-status-badge";

const NOTE_MAX = 200;
/** The counter appears only near the limit, where it helps. */
const NOTE_COUNTER_FROM = 160;

function StatusDot({ status }: { status: AttendanceStatus }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", ATTENDANCE_DOT[status])} />;
}

/**
 * One person on the roll: when they came, and the clerk's call. The picker
 * exists only while the roll is open; a finalized roll reads like a report.
 * The row is its own container: when it is narrow (room sidebar, phone,
 * enlarged text) the picker drops under the name instead of squeezing it.
 */
export function MeetingAttendanceRowItem({
  row,
  editable,
  formatTime,
  avatarUrl,
  onMark,
  onReset,
}: {
  row: MeetingAttendanceRow;
  /** Clerk on an open roll. */
  editable: boolean;
  formatTime: (iso: string) => string;
  avatarUrl?: unknown;
  /** Rejects when the server refuses; the cache is already rolled back by then. */
  onMark: (status: AttendanceStatus, note?: string) => Promise<unknown>;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const noteId = useId();
  const status = asAttendanceStatus(row.status);
  const [note, setNote] = useState(row.note ?? "");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const noteRef = useRef<HTMLInputElement>(null);
  const focusNoteNext = useRef(false);
  // Only the latest save may report back; an older one landing late must not
  // say "saved" over newer typing or roll it back.
  const saveSeq = useRef(0);
  useEffect(() => setNote(row.note ?? ""), [row.note]);
  useEffect(() => {
    saveSeq.current++;
    setNoteState("idle");
  }, [status]);
  // Picking "excused" reveals the reason field; take the clerk there, after the
  // picker has handed focus back to its trigger.
  useEffect(() => {
    if (status !== "EXCUSED" || !focusNoteNext.current) return;
    focusNoteNext.current = false;
    const frame = requestAnimationFrame(() => noteRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [status]);

  const minutes = Math.round(row.present_seconds / 60);
  const presence = !row.first_joined_at
    ? t("meetings.governance.notJoined")
    : row.in_room
      ? t("meetings.governance.inRoomSince", { time: formatTime(row.first_joined_at) })
      : minutes < 1
        ? t("meetings.governance.joinedBrief", { time: formatTime(row.first_joined_at) })
        : t("meetings.governance.joined", { time: formatTime(row.first_joined_at), count: minutes });
  const label = (s: AttendanceStatus) => t(`meetings.governance.status_${s}`);
  const items = ATTENDANCE_STATUSES.map((s) => ({ value: s, label: label(s) }));
  const saveNote = () => {
    const next = note.trim();
    if (next === (row.note ?? "")) return;
    const seq = ++saveSeq.current;
    const saved = row.note ?? "";
    setNoteState("saving");
    onMark("EXCUSED", next).then(
      () => {
        if (seq === saveSeq.current) setNoteState("saved");
      },
      // A refused save puts the saved reason back rather than leaving an unsaved one on screen.
      () => {
        if (seq !== saveSeq.current) return;
        setNoteState("idle");
        setNote(saved);
      },
    );
  };

  return (
    <li className="@container px-2 py-2.5">
      <div
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2",
          editable && "grid-cols-[auto_minmax(0,1fr)] @md:grid-cols-[auto_minmax(0,1fr)_auto]",
        )}
      >
        <MeetingPersonAvatar name={row.display_name} avatarUrl={avatarUrl} size="default" />
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-body font-medium text-foreground">{row.display_name}</p>
          <p className="text-caption text-muted-foreground">
            {/* Off the meeting now, still on the finalized roll: the chip says why the name is here. */}
            {row.removed ? (
              <ToneBadge tone="muted" className="mr-1.5 align-middle">
                {t("meetings.governance.removedChip")}
              </ToneBadge>
            ) : null}
            {presence}
            {/* Kept whole: "Tự động" split across two lines reads as two words. */}
            {row.source !== "MANUAL" ? (
              <span className="whitespace-nowrap"> · {t("meetings.governance.sourceAuto")}</span>
            ) : null}
          </p>
        </div>
        {editable ? (
          <div className="col-start-2 flex min-w-0 items-center gap-1 @md:col-start-auto @md:justify-end">
            <Select
              items={items}
              value={status}
              onValueChange={(next) => {
                if (!next) return;
                focusNoteNext.current = next === "EXCUSED";
                onMark(next as AttendanceStatus).catch(() => undefined);
              }}
            >
              <SelectTrigger
                size="sm"
                variant="subtle"
                className="min-w-0 flex-1 @md:w-40 @md:flex-none"
                aria-label={t("meetings.governance.statusFor", { name: row.display_name })}
              >
                <SelectValue>
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot status={status} />
                    <span className="truncate">{label(status)}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    <StatusDot status={i.value} />
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row.source === "MANUAL" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={t("meetings.governance.resetToAuto", { name: row.display_name })}
                      onClick={onReset}
                    />
                  }
                >
                  <Undo2 aria-hidden className="size-4" />
                </TooltipTrigger>
                <TooltipContent>{t("meetings.governance.resetToAutoShort")}</TooltipContent>
              </Tooltip>
            ) : (
              // Holds the reset button's place so the pickers line up down the column.
              <span aria-hidden className="hidden size-7 shrink-0 pointer-coarse:size-11 @md:block" />
            )}
          </div>
        ) : (
          <ToneBadge
            // Uncounted rows do not ask to be noticed: an observer's absence, or
            // anyone added after finalize (not on the roll until it is reopened).
            tone={
              row.joined_after_finalize || (status === "ABSENT" && row.standing !== "MEMBER")
                ? "muted"
                : ATTENDANCE_TONE[status]
            }
            className="shrink-0"
          >
            {label(status)}
          </ToneBadge>
        )}
        {status === "EXCUSED" ? (
          editable ? (
            <div className="col-start-2 col-end-[-1] space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-caption text-muted-foreground">
                {/* The visible label; the field's own name also says whose reason it is. */}
                <label htmlFor={noteId}>{t("meetings.governance.excuseReason")}</label>
                <span className="flex items-baseline gap-2 tabular-nums">
                  {/* Only the save outcome is announced; a counter in a live region would speak every keystroke. */}
                  <span role="status">
                    {noteState === "saving" ? t("meetings.governance.noteSaving") : null}
                    {noteState === "saved" ? t("meetings.governance.noteSaved") : null}
                  </span>
                  {note.length >= NOTE_COUNTER_FROM ? <span id={`${noteId}-count`}>{`${note.length}/${NOTE_MAX}`}</span> : null}
                </span>
              </div>
              <Input
                ref={noteRef}
                id={noteId}
                value={note}
                maxLength={NOTE_MAX}
                aria-label={t("meetings.governance.excuseReasonFor", { name: row.display_name })}
                aria-describedby={note.length >= NOTE_COUNTER_FROM ? `${noteId}-count` : undefined}
                placeholder={t("meetings.governance.excuseReasonHint")}
                className="h-8"
                onChange={(e) => {
                  saveSeq.current++;
                  setNote(e.target.value);
                  setNoteState("idle");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={saveNote}
              />
            </div>
          ) : row.note ? (
            <p className="col-start-2 col-end-[-1] text-caption text-muted-foreground">
              {t("meetings.governance.excuseNote", { note: row.note })}
            </p>
          ) : null
        ) : null}
      </div>
    </li>
  );
}

"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type MeetingAttendanceRow } from "@uniwork/core/types/meeting";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";

const NOTE_MAX = 200;

/**
 * One person on the roll (LiveSecretary `.roll-row`): avatar 28, the name, a
 * caption with their duty ("Thư ký · bạn") or the reason they are away, and a
 * status select for whoever clerks an open roll. Picking "Vắng có
 * phép" opens the reason field; the reason caption reopens it.
 */
export function RollRow({
  row,
  isHost,
  editable,
  onMark,
}: {
  row: MeetingAttendanceRow;
  isHost: boolean;
  editable: boolean;
  /** Rejects when the server refuses; the cache is already rolled back by then. */
  onMark: (status: AttendanceStatus, note?: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { memberIndex } = useDetail();
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(row.note ?? "");
  const status = (ATTENDANCE_STATUSES as readonly string[]).includes(row.status) ? (row.status as AttendanceStatus) : "ABSENT";
  const myId = useAuthStore((s) => s.user?.id);
  const me = Boolean(row.user_id) && row.user_id === myId;
  const duty = [
    isHost ? t("meetings.detail.roll.host") : row.is_secretary ? t("meetings.detail.roll.secretary") : null,
    me ? t("meetings.detail.roll.you") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const reason = status === "EXCUSED" ? row.note?.trim() : "";
  const label = (s: AttendanceStatus) => t(`meetings.detail.roll.status_${s}`);
  const items = ATTENDANCE_STATUSES.map((s) => ({ value: s, label: label(s) }));
  const saveNote = () => {
    setEditingNote(false);
    if (note.trim() !== (row.note ?? "").trim()) onMark("EXCUSED", note.trim()).catch(() => setNote(row.note ?? ""));
  };

  return (
    <li className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 py-1.5">
      <MeetingPersonAvatar
        name={row.display_name}
        avatarUrl={row.user_id ? memberIndex.memberOf(row.user_id)?.avatar_url : undefined}
        size={28}
        tint={meetingAvatarTint(row.user_id, memberIndex.members)}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body font-medium">{row.display_name}</span>
        {duty ? <span className="block text-caption text-muted-foreground">{duty}</span> : null}
        {reason && !(editable && editingNote) ? (
          editable ? (
            <button
              type="button"
              className="block text-left text-caption text-muted-foreground hover:text-foreground"
              aria-label={t("meetings.detail.roll.reasonFor", { name: row.display_name })}
              onClick={() => setEditingNote(true)}
            >
              {reason}
            </button>
          ) : (
            <span className="block text-caption text-muted-foreground">{reason}</span>
          )
        ) : null}
        {editable && status === "EXCUSED" && !reason && !editingNote ? (
          <button
            type="button"
            className="block text-caption font-medium text-primary hover:underline"
            onClick={() => setEditingNote(true)}
          >
            {t("meetings.detail.roll.addReason")}
          </button>
        ) : null}
      </span>
      {editable ? (
        <Select
          items={items}
          value={status}
          onValueChange={(next) => {
            if (!next) return;
            setEditingNote(next === "EXCUSED");
            onMark(next as AttendanceStatus).catch(() => undefined);
          }}
        >
          <SelectTrigger
            className="w-34 flex-none rounded-md bg-background hover:bg-surface-hover [&_svg]:size-3"
            aria-label={t("meetings.detail.roll.statusFor", { name: row.display_name })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="flex-none text-caption text-muted-foreground">{label(status)}</span>
      )}
      {editable && editingNote && status === "EXCUSED" ? (
        <div className="basis-full pl-10">
          <Input
            ref={(el) => el?.focus()}
            value={note}
            maxLength={NOTE_MAX}
            aria-label={t("meetings.detail.roll.reasonFor", { name: row.display_name })}
            placeholder={t("meetings.detail.roll.reasonPlaceholder")}
            className="h-8"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={saveNote}
          />
        </div>
      ) : null}
    </li>
  );
}

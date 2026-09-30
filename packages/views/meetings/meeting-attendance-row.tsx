"use client";
import { useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ATTENDANCE_STATUSES, type AttendanceStatus, type MeetingAttendanceRow } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { MeetingPersonAvatar } from "./meeting-person";
import { ToneBadge, type MeetingTone } from "./meeting-status-badge";

const STATUS_TONE: Record<AttendanceStatus, MeetingTone> = {
  PRESENT: "success",
  LATE: "warning",
  EXCUSED: "info",
  ABSENT: "muted",
};

function asStatus(s: string): AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(s) ? (s as AttendanceStatus) : "ABSENT";
}

/** One person on the roll: when they came, and the clerk's call. */
export function MeetingAttendanceRowItem({
  row,
  canEdit,
  finalized,
  locale,
  onMark,
  onReset,
}: {
  row: MeetingAttendanceRow;
  canEdit: boolean;
  finalized: boolean;
  locale: string;
  onMark: (status: AttendanceStatus, note?: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const status = asStatus(row.status);
  const [note, setNote] = useState(row.note ?? "");
  useEffect(() => setNote(row.note ?? ""), [row.note]);
  const joined = row.first_joined_at
    ? t("meetings.governance.joined", {
        time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(row.first_joined_at)),
        count: Math.round(row.present_seconds / 60),
      })
    : t("meetings.governance.notJoined");
  const items = ATTENDANCE_STATUSES.map((s) => ({ value: s, label: t(`meetings.governance.status_${s}`) }));
  return (
    <li className="space-y-2 px-2 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <MeetingPersonAvatar name={row.display_name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-foreground">{row.display_name}</p>
          <p className="truncate text-caption text-muted-foreground">
            {row.in_room ? t("meetings.governance.inRoomNow") : joined}
            {row.source !== "MANUAL" ? ` · ${t("meetings.governance.sourceAuto")}` : null}
          </p>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1">
            {row.source === "MANUAL" && !finalized ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("meetings.governance.resetToAuto", { name: row.display_name })}
                onClick={onReset}
              >
                <Undo2 aria-hidden className="size-4" />
              </Button>
            ) : null}
            <Select items={items} value={status} onValueChange={(next) => next && onMark(next as AttendanceStatus)}>
              <SelectTrigger
                size="sm"
                variant="subtle"
                className="w-32"
                aria-label={t("meetings.governance.statusFor", { name: row.display_name })}
              >
                <SelectValue>{t(`meetings.governance.status_${status}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <ToneBadge tone={STATUS_TONE[status]}>{t(`meetings.governance.status_${status}`)}</ToneBadge>
        )}
      </div>
      {canEdit && status === "EXCUSED" ? (
        <Input
          value={note}
          maxLength={200}
          aria-label={t("meetings.governance.excuseReason")}
          placeholder={t("meetings.governance.excuseReason")}
          className="h-8"
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note.trim() !== (row.note ?? "")) onMark("EXCUSED", note.trim());
          }}
        />
      ) : null}
    </li>
  );
}

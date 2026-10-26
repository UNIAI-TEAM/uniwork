"use client";
import { useState, type ReactNode } from "react";
import { ChevronRight, ListTodo, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCarriedOverItems } from "@uniwork/core/meetings/action-items";
import { useMeetingAttendance } from "@uniwork/core/meetings/attendance";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { RollDrawer } from "../live/roll-drawer";
import { CarriedOverBrief } from "../scheduled/carried-over-brief";
import { AvatarStack } from "../ui/avatar-stack";
import { CountPill } from "../ui/count-pill";
import { SideSheet } from "../ui/overlay";
import { attendedText, rollParts } from "./rail-model";
import { RailProperties } from "./rail-properties";

/**
 * After the meeting on a phone (PhoneAfter `.p-people`): the faces and
 * "3/3 có mặt" under the header, one tap to the full property list in a
 * sheet, so the tabs stay on the first screen.
 */
export function PhonePeopleRow() {
  const { t } = useTranslation();
  const { meeting, participants, memberIndex } = useDetail();
  const [open, setOpen] = useState(false);
  const { data: roll } = useMeetingAttendance(meeting.id);
  const ordered = [...participants].sort(
    (a, b) => Number(b.user_id === meeting.host_user_id) - Number(a.user_id === meeting.host_user_id),
  );
  if (ordered.length === 0) return null;
  const value = roll ? attendedText(roll.summary, t) : t("meetings.detail.rail.people_count", { count: ordered.length });
  const people = ordered.map((p) => ({
    id: p.id,
    name: p.display_name_snapshot || memberIndex.memberOf(p.user_id)?.display_name || t("meetings.formerMember"),
    avatarUrl: memberIndex.memberOf(p.user_id)?.avatar_url,
    tint: meetingAvatarTint(p.principal_type === "USER" ? p.user_id : null, memberIndex.members),
  }));
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t("meetings.detail.phone.detailsAria", { value })}
        onClick={() => setOpen(true)}
        className="-mx-2 mt-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 text-left text-body hover:bg-surface-hover active:bg-muted"
      >
        <AvatarStack people={people} className="-my-0.5" />
        <span>{value}</span>
        <span className="ml-auto inline-flex items-center gap-0.5 text-caption text-muted-foreground">
          {t("meetings.detail.phone.details")}
          <ChevronRight aria-hidden className="size-3" />
        </span>
      </button>
      <SideSheet open={open} onOpenChange={setOpen} width={480} title={t("meetings.detail.phone.detailsTitle")}>
        <RailProperties />
      </SideSheet>
    </>
  );
}

/** One row of PhoneLive's `.links`: icon, a label (and its value), a chevron; 56 tall. */
function LinkRow({ icon: Icon, ariaLabel, onClick, children }: { icon: typeof Users; ariaLabel: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      onClick={onClick}
      className="grid min-h-14 w-full grid-cols-[16px_minmax(0,1fr)_14px] items-center gap-x-3 py-2 text-left text-foreground hover:bg-surface-hover"
    >
      <Icon aria-hidden className="size-4 text-muted-foreground" />
      <span>{children}</span>
      <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
    </button>
  );
}

/**
 * While live on a phone (PhoneLive `.links`): the roll and the carried-over
 * work as two rows after the notes, instead of the stacked rail above them.
 */
export function PhoneLiveLinks() {
  const { t } = useTranslation();
  const { meeting, sections, roll: rollState } = useDetail();
  const [carried, setCarried] = useState(false);
  const { data: roll } = useMeetingAttendance(meeting.id);
  const { data: carriedOver } = useMeetingCarriedOverItems(sections.carriedOver ? meeting.id : "");
  const parts = roll ? rollParts(roll.summary, t) : [];
  const value = parts.length > 0 ? parts.join(" · ") : t("meetings.detail.rail.rollEmpty");
  const inRoom = roll?.rows.filter((r) => r.in_room).length ?? 0;
  const sub = inRoom > 0 ? t("meetings.detail.rail.inRoom", { count: inRoom }) : t("meetings.detail.rail.nobodyInRoom");
  const total = carriedOver?.total ?? 0;
  return (
    <div className="mt-6">
      {roll ? (
        <LinkRow
          icon={Users}
          ariaLabel={t("meetings.detail.rail.rollAria", { value: parts.join(", ") || value, sub })}
          onClick={() => rollState.setOpen(true)}
        >
          <span className="block text-body font-medium">{t("meetings.detail.rail.roll")}</span>
          <span className="mt-0.5 block text-caption text-muted-foreground">{value}</span>
        </LinkRow>
      ) : null}
      {total > 0 ? (
        <LinkRow icon={ListTodo} ariaLabel={t("meetings.detail.phone.carriedOverAria", { count: total })} onClick={() => setCarried(true)}>
          <span className="flex items-center gap-2 text-body font-medium">
            {t("meetings.detail.carriedOver.title")}
            <CountPill>{total}</CountPill>
          </span>
        </LinkRow>
      ) : null}
      <RollDrawer open={rollState.open} onOpenChange={rollState.setOpen} />
      <SideSheet open={carried} onOpenChange={setCarried} width={480} title={t("meetings.detail.carriedOver.title")}>
        <CarriedOverBrief />
      </SideSheet>
    </div>
  );
}

"use client";
import { Fragment, useState } from "react";
import { Crown, FileText, FolderKanban, Link, PenLine, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { inviteLinkStatus, useInviteLinks } from "@uniwork/core/meetings";
import { useMeetingAttendance } from "@uniwork/core/meetings/attendance";
import { useMeetingMinutes } from "@uniwork/core/meetings/minutes";
import { paths } from "@uniwork/core/paths";
import { useProject } from "@uniwork/core/tasks";
import { useWorkspace } from "../../../layout/workspace-context";
import { AppLink } from "../../../navigation";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { shortDay } from "../format";
import { RollDrawer } from "../live/roll-drawer";
import { GuestLinks } from "../scheduled/guest-link-row";
import { SideSheet } from "../ui/overlay";
import { RailProp } from "../ui/rail";
import { RailAiRow } from "./rail-ai-popover";
import { RailDialInRow } from "./rail-dial-in";
import { isLive, rollParts } from "./rail-model";
import { RailPeopleRow } from "./rail-people-popover";

/** A person beside a rail label: avatar 24 and the name (kit `.prop-v > .av`). */
function Person({ userId, name }: { userId?: string; name: string }) {
  const { memberIndex } = useDetail();
  return (
    <>
      <MeetingPersonAvatar
        name={name}
        avatarUrl={memberIndex.memberOf(userId)?.avatar_url}
        size={24}
        tint={meetingAvatarTint(userId, memberIndex.members)}
        className="-my-0.5 mr-1.5 align-middle"
      />
      {name}
    </>
  );
}

/** Keeps a phrase's last words on one line ("Chưa ai vào / phòng trực tuyến"), kit `.nw`. */
function KeepTail({ text, words }: { text: string; words: number }) {
  const all = text.split(" ");
  if (all.length <= words) return <span className="whitespace-nowrap">{text}</span>;
  return (
    <>
      {all.slice(0, -words).join(" ")} <span className="whitespace-nowrap">{all.slice(-words).join(" ")}</span>
    </>
  );
}

/** Live: "3 có mặt · 1 muộn · 1 vắng có phép", who is in the online room, and the roll drawer. */
function RollRow() {
  const { t } = useTranslation();
  const {
    meeting,
    roll: { open, setOpen },
  } = useDetail();
  const { data: roll } = useMeetingAttendance(meeting.id);
  if (!roll) return null;
  const parts = rollParts(roll.summary, t);
  const inRoom = roll.rows.filter((r) => r.in_room).length;
  const sub = inRoom > 0 ? t("meetings.detail.rail.inRoom", { count: inRoom }) : t("meetings.detail.rail.nobodyInRoom");
  const value = parts.length > 0 ? parts.join(" · ") : t("meetings.detail.rail.rollEmpty");
  return (
    <>
      <RailProp
        icon={Users}
        label={t("meetings.detail.rail.roll")}
        value={
          parts.length > 0
            ? parts.map((part, i) => (
                // The separators stay text of the value itself (kit `<span class="nw">3 có mặt</span> · …`).
                <Fragment key={part}>
                  {i > 0 ? " · " : null}
                  <span className="whitespace-nowrap">{part}</span>
                </Fragment>
              ))
            : value
        }
        sub={<KeepTail text={sub} words={3} />}
        onClick={() => setOpen(true)}
        ariaLabel={t("meetings.detail.rail.rollAria", { value: parts.join(", ") || value, sub })}
      />
      <RollDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * "Khách" (host or admin only: the links answer 403 to anyone else, so this
 * is never mounted for them). Before the meeting it scrolls to the guest
 * links on the page; while live it opens them in a drawer.
 */
function GuestsRow() {
  const { t } = useTranslation();
  const { meeting, displayStatus, now } = useDetail();
  const [open, setOpen] = useState(false);
  const { data } = useInviteLinks(meeting.id);
  const active = (data ?? []).filter((link) => inviteLinkStatus(link, new Date(now)) === "active");
  if (active.length === 0) return null;
  const live = isLive(displayStatus);
  const first = active[0]!;
  const count = t("meetings.detail.rail.links", { count: active.length });
  if (!live) {
    return (
      <RailProp
        icon={Link}
        label={t("meetings.detail.rail.guests")}
        value={count}
        onClick={() => document.getElementById("khach")?.scrollIntoView({ block: "start" })}
        ariaLabel={t("meetings.detail.rail.guestsAria", { count })}
      />
    );
  }
  const value = [
    count,
    first.access_mode === "REQUEST_APPROVAL" ? t("meetings.detail.rail.needsApproval") : null,
    first.max_uses != null ? t("meetings.detail.rail.uses", { used: first.used_count, max: first.max_uses }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const expires = t("meetings.detail.rail.expires", { day: shortDay(first.expires_at, now, t) });
  const sub = active.length === 1 ? `${first.name} · ${expires}` : undefined;
  return (
    <>
      <RailProp
        icon={Link}
        label={t("meetings.detail.rail.guests")}
        value={value}
        sub={
          sub ? (
            <>
              {first.name} · <span className="whitespace-nowrap">{expires}</span>
            </>
          ) : undefined
        }
        onClick={() => setOpen(true)}
        ariaLabel={t("meetings.detail.rail.guestsManageAria", { value: sub ? `${value}, ${sub}` : value })}
      />
      <SideSheet open={open} onOpenChange={setOpen} width={480} title={t("meetings.detail.rail.guestsTitle")}>
        <GuestLinks bare />
      </SideSheet>
    </>
  );
}

function ProjectRow({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { workspaceId } = useDetail();
  const { workspace } = useWorkspace();
  const { data: project } = useProject(workspaceId, projectId);
  if (!project) return null;
  return (
    <RailProp
      icon={FolderKanban}
      label={t("meetings.detail.rail.project")}
      value={
        <AppLink
          href={paths.workspace(workspace.organization_slug, workspace.slug).project(project.id)}
          className="relative rounded-xs text-foreground underline-offset-4 hover:underline pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3"
        >
          {project.title}
        </AppLink>
      }
    />
  );
}

/** "Biên bản": Chưa có · Bản nháp · Đã chốt; a clerk (or anyone, once final) opens the tab. */
function MinutesRow() {
  const { t } = useTranslation();
  const { meeting, viewer, isClerk, tabs } = useDetail();
  const { data: minutes, isPending } = useMeetingMinutes(meeting.id);
  if (isPending) return null;
  const label = t("meetings.detail.rail.minutes");
  if (viewer === "outsider") {
    return <RailProp icon={FileText} label={label} value={t(minutes?.finalized ? "meetings.detail.rail.minutesFinal" : "meetings.detail.rail.minutesNotFinal")} />;
  }
  if (!minutes) {
    const none = t("meetings.detail.rail.minutesNone");
    // The tab is hidden until minutes exist; a clerk opens it here to create them.
    const creates = isClerk && tabs.list.includes("minutes");
    return (
      <RailProp
        icon={FileText}
        label={label}
        value={<span className="text-muted-foreground">{none}</span>}
        onClick={creates ? () => tabs.set("minutes") : undefined}
        haspopup={false}
        // Nothing to open yet (AfterAIStates): no chevron; the hover fill still shows a clerk can start them here.
        chevron={false}
        ariaLabel={creates ? t("meetings.detail.rail.minutesAria", { value: none }) : undefined}
      />
    );
  }
  const value = t(minutes.finalized ? "meetings.detail.rail.minutesFinal" : "meetings.detail.rail.minutesDraft");
  const opens = tabs.list.includes("minutes") && (isClerk || minutes.finalized);
  return (
    <RailProp
      icon={FileText}
      label={label}
      value={value}
      sub={!opens && !minutes.finalized ? t("meetings.detail.rail.minutesClerkWorking") : undefined}
      onClick={opens ? () => tabs.set("minutes") : undefined}
      haspopup={false}
      ariaLabel={opens ? t("meetings.detail.rail.minutesAria", { value }) : undefined}
    />
  );
}

/**
 * The rail's property rows (kit `.props`), by status and viewer: Chủ trì,
 * Thư ký, Người dự (or Điểm danh + Lời mời while live), Khách, Dự án,
 * Thư ký UNI, Biên bản, Gọi vào. A row with nothing to say is not drawn.
 */
export function RailProperties() {
  const { t } = useTranslation();
  const { meeting, displayStatus, participants, memberIndex, viewer, sections } = useDetail();
  const me = useAuthStore((s) => s.user?.id);
  const live = isLive(displayStatus);
  const canceled = displayStatus === "CANCELED";
  const before = displayStatus === "SCHEDULED";
  const hostName =
    memberIndex.memberOf(meeting.host_user_id)?.display_name ||
    participants.find((p) => p.user_id === meeting.host_user_id)?.display_name_snapshot;
  const secretaries = participants.filter((p) => p.is_secretary && p.principal_type === "USER");

  return (
    <div className="flex flex-col">
      {hostName ? (
        <RailProp icon={Crown} label={t("meetings.detail.rail.host")} value={<Person userId={meeting.host_user_id} name={hostName} />} />
      ) : null}
      {!canceled && secretaries.length > 0 ? (
        <RailProp
          icon={PenLine}
          label={t("meetings.detail.rail.secretary")}
          value={secretaries.map((p, i) => {
            const name = p.display_name_snapshot || memberIndex.memberOf(p.user_id)?.display_name || t("meetings.formerMember");
            return (
              <span key={p.id}>
                {i > 0 ? ", " : null}
                <Person userId={p.user_id} name={name} />
                {viewer === "secretary" && p.user_id === me ? t("meetings.detail.rail.you") : null}
              </span>
            );
          })}
        />
      ) : null}
      {live ? <RollRow /> : null}
      {canceled ? null : <RailPeopleRow />}
      {sections.guestLinks ? <GuestsRow /> : null}
      {!live && meeting.project_id ? <ProjectRow projectId={meeting.project_id} /> : null}
      {canceled || displayStatus === "MISSED" ? null : <RailAiRow />}
      {sections.minutes ? <MinutesRow /> : null}
      {before || live ? <RailDialInRow /> : null}
    </div>
  );
}

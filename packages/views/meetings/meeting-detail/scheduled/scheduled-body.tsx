"use client";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../../../layout/workspace-context";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { NotesFeed } from "../live/notes-feed";
import { NoticeLine } from "../ui/notice-line";
import { Section } from "../ui/section";
import { CarriedOverBrief, PHONE_SECTION } from "./carried-over-brief";
import { GuestLinks } from "./guest-link-row";
import { rsvpState } from "./rsvp-model";
import { SeriesBrief } from "./series-brief";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";

const RSVP_DOT = {
  ACCEPTED: "bg-success",
  DECLINED: "bg-destructive",
  TENTATIVE: "bg-background inset-ring-[1.5px] inset-ring-input",
  PENDING: "bg-background inset-ring-[1.5px] inset-ring-input",
} as const;

/** The phone's "Người dự" (PhoneScheduled): the rail's people as 52px rows with their answer. */
function PhonePeople() {
  const { t } = useTranslation();
  const { user } = useWorkspace();
  const { meeting, participants, invitations, memberIndex } = useDetail();
  const people = participants.filter((p) => p.principal_type === "USER" || p.principal_type === "GUEST");
  return (
    <Section id="nguoi-du" title={t("meetings.detail.scheduled.people")} count={people.length} className={PHONE_SECTION}>
      <ul aria-label={t("meetings.detail.scheduled.people")} className="-mt-2 divide-y divide-border">
        {people.map((p) => {
          const host = p.user_id === meeting.host_user_id;
          const state = rsvpState(invitations.find((inv) => inv.participant_id === p.id)?.response_status);
          const name = p.display_name_snapshot ?? memberIndex.memberOf(p.user_id)?.display_name ?? "";
          return (
            <li key={p.id} className="flex min-h-13 items-center gap-3">
              <span className="relative inline-flex">
                <MeetingPersonAvatar name={name} size={28} tint={meetingAvatarTint(p.user_id, memberIndex.members)} />
                {host ? null : (
                  <span
                    aria-hidden
                    className={cn("absolute -right-0.75 -bottom-0.75 size-2 rounded-full ring-2 ring-background", RSVP_DOT[state])}
                  />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-medium">{name}</span>
                <span className="text-caption text-muted-foreground">
                  {host
                    ? t("meetings.detail.scheduled.host")
                    : t(`meetings.detail.scheduled.${p.user_id === user.id ? "you" : "rsvp"}_${state}`)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {meeting.scribe_enabled ? (
        <NoticeLine tone="muted" icon={ScribeMark} className="mt-2 text-caption [&_svg]:size-3.5 [&>div>div]:text-caption">
          {t(meeting.ai_content_shared ? "meetings.detail.scheduled.aiShared" : "meetings.detail.scheduled.aiPrivate")}
        </NoticeLine>
      ) : null}
    </Section>
  );
}

/**
 * The scheduled page's main column (ScheduledMember, ScheduledHost,
 * SeriesBrief, PhoneScheduled): Mô tả; on a phone the people; a follow-up's
 * brief of the previous meeting; the host's guest links; the clerks' notes
 * written ahead; then the carried-over work — open for an invitee, one line
 * for the host, whose page already holds the links and notes.
 */
export function ScheduledBody() {
  const { t } = useTranslation();
  const { meeting, sections, isClerk, canHost, isPhone } = useDetail();
  const previousId = meeting.previous_meeting_id;
  const description = meeting.description.trim();
  return (
    // Under the strip the first heading sits 20 below it, level with the rail (kit `.strip + .grid`, A's grid adds 16);
    // on a phone the first section keeps its 24 under the room row (PhoneScheduled `.phone .section`).
    // "+ Thêm biểu quyết" (the only direct div > button here) is the kit's bare 16-tall `.text-btn`: no py, no line strut.
    <div className="flex min-w-0 flex-col [&>section:first-child]:mt-1 @max-[37.5rem]/meeting:[&>section:first-child]:mt-2 [&>div:has(>button)]:flex [&>div>button]:py-0">
      {description ? (
        previousId ? (
          <div className="mt-2 grid grid-cols-[56px_minmax(0,1fr)] items-start @max-[37.5rem]/meeting:grid-cols-[52px_minmax(0,1fr)]">
            <span className="justify-self-start pt-1 text-caption text-muted-foreground">{t("meetings.detail.scheduled.description")}</span>
            <p className="max-w-150 text-body-lg">{description}</p>
          </div>
        ) : (
          // Phone: the prose sits 8 under its heading (PhoneScheduled `.sh + .prose`).
          <Section
            id="mo-ta"
            title={t("meetings.detail.scheduled.description")}
            className={cn(PHONE_SECTION, "@max-[37.5rem]/meeting:[&>div:last-child]:mt-2")}
          >
            <p className="max-w-160 text-body-lg whitespace-pre-line">{description}</p>
          </Section>
        )
      ) : null}
      {isPhone ? <PhonePeople /> : null}
      {previousId ? <SeriesBrief previousId={previousId} /> : null}
      {sections.guestLinks ? <GuestLinks /> : null}
      {isClerk && sections.notesInput ? <NotesFeed variant="scheduled" /> : null}
      {sections.carriedOver ? (
        <CarriedOverBrief variant={canHost && !isPhone ? "line" : "full"} excludeMeetingId={previousId} />
      ) : null}
    </div>
  );
}

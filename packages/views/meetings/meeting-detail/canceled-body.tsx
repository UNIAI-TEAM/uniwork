"use client";
import { useTranslation } from "react-i18next";
import { useDetail } from "./detail-context";
import { meetingAvatarTint } from "./avatar-tint";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../meeting-person";
import { rsvpOf } from "./rail/rail-model";
import { Section } from "./ui/section";

/** "Mô tả": the agenda as written, body-lg, nothing when there is none. */
export function DescriptionSection() {
  const { t } = useTranslation();
  const { meeting } = useDetail();
  if (!meeting.description?.trim()) return null;
  return (
    <Section id="description" title={t("meetings.detail.states.description")}>
      <p className="max-w-160 text-body-lg break-words whitespace-pre-wrap">{meeting.description}</p>
    </Section>
  );
}

/** The RSVP dot on a face (kit `.rsvp`), as the rail's stack draws it; "maybe" is hollow there too. */
const DOT = {
  yes: "bg-success",
  no: "bg-destructive",
  maybe: "bg-background inset-ring-[1.5px] inset-ring-input",
  wait: "bg-background inset-ring-[1.5px] inset-ring-input",
} as const;

/**
 * The canceled page (Canceled board): what it was about and who had been
 * invited, each with their answer. No summary, no tabs, no notes input.
 */
export function CanceledBody() {
  const { t } = useTranslation();
  const { meeting, participants, invitations, memberIndex } = useDetail();
  const people = invitations.flatMap((inv) => {
    const p = participants.find((x) => x.id === inv.participant_id);
    if (!p || p.user_id === meeting.host_user_id) return [];
    const member = memberIndex.memberOf(p.user_id);
    const name = p.display_name_snapshot || member?.display_name || t("meetings.formerMember");
    const rsvp = rsvpOf(inv.response_status);
    return [{ id: p.id, name, avatarUrl: member?.avatar_url, tint: meetingAvatarTint(p.user_id, memberIndex.members), rsvp }];
  });
  return (
    <>
      <DescriptionSection />
      {people.length > 0 ? (
        <Section id="invitees" title={t("meetings.detail.states.invitees")} count={people.length}>
          <ul className="-mt-1.5 flex flex-col">
            {people.map((person) => (
              <li key={person.id} className="flex min-h-9 items-center gap-2.5">
                <span aria-hidden className="relative inline-flex">
                  <MeetingPersonAvatar name={person.name} avatarUrl={person.avatarUrl} tint={person.tint} size={24} />
                  <span className={cn("absolute -right-0.75 -bottom-0.75 size-2 rounded-full ring-2 ring-background", DOT[person.rsvp])} />
                </span>
                <span className="text-body font-medium">{person.name}</span>
                <span className="text-caption text-muted-foreground">{t(person.rsvp === "maybe" ? "meetings.tentative" : `meetings.detail.states.rsvp_${person.rsvp}`)}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

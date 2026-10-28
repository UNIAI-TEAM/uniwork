"use client";
import { Check } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useRespondInvitation } from "@uniwork/core/meetings";
import { meetingVenue } from "@uniwork/core/meetings/venue";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../../../layout/workspace-context";
import { toastApiError } from "../../../toast-api-error";
import { MeetingCalendarButton } from "../../meeting-calendar-button";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { clock, dayWord, shortDay } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { StripRow } from "../ui/strip";
import { TextButton } from "../ui/text-button";
import { myInvitation, rsvpState, type RsvpAnswer } from "./rsvp-model";

const ANSWERS: readonly RsvpAnswer[] = ["ACCEPTED", "TENTATIVE", "DECLINED"];
const ANSWER_LABEL: Record<RsvpAnswer, string> = {
  ACCEPTED: "meetings.accept",
  TENTATIVE: "meetings.tentative",
  DECLINED: "meetings.decline",
};

/**
 * The invitee's next step before a meeting (ScheduledMember, PhoneScheduled):
 * who invites them, the three answers as one segmented control with none
 * chosen until they answer, then the answer folded into one line with "Đổi".
 * `strip` is the strip row ([Thêm vào lịch] + the page's join button passed
 * in `actions`); on a phone it becomes the room row and the answer moves to
 * `phoneBar`, the bottom bar's full-width control. Nothing without an
 * invitation of the viewer's own.
 */
export function StripRsvpRow({ variant, actions }: { variant: "strip" | "phoneBar"; actions?: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useWorkspace();
  const { meeting, participants, invitations, memberIndex, now, isPhone } = useDetail();
  const rsvp = useRespondInvitation(meeting.id);
  const [changing, setChanging] = useState(false);
  // An answer given from the keyboard hands focus to "Đổi" once the control folds into the answered line.
  const refocus = useRef(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!refocus.current || !changeButton.current) return;
    changeButton.current.focus();
    refocus.current = false;
  });
  const invitation = myInvitation(participants, invitations, user.id);
  if (!invitation) return null;

  const hostId = meeting.host_user_id;
  const hostName =
    participants.find((p) => p.user_id === hostId)?.display_name_snapshot ??
    memberIndex.memberOf(hostId)?.display_name ??
    "";
  const saved = rsvpState(invitation.response_status);
  // Not optimistic (State Rules): the choice shows while it is saved, then the server's answer.
  const shown = rsvp.isPending ? rsvpState(rsvp.variables?.response) : saved;
  const value = shown === "PENDING" ? null : shown;

  const answer = (response: RsvpAnswer) => {
    if (response === saved) {
      setChanging(false);
      return;
    }
    rsvp.mutate(
      { invitationId: invitation.id, response },
      { onSuccess: () => setChanging(false), onError: (err) => toastApiError(err, t("common.error")) },
    );
  };

  // The kit's `.seg` look as toggle buttons, not radios: an arrow on a radio would save the answer it passes,
  // and each answer is a server write. While one saves the others refuse, focus stays put (aria-disabled).
  const control = (className: string) => (
    <div
      role="group"
      aria-label={t("meetings.detail.scheduled.answerLegend", { name: hostName })}
      className={cn(
        "inline-flex h-10 min-w-0 divide-x divide-input overflow-hidden rounded-control border border-input pointer-coarse:h-auto @max-[37.5rem]/meeting:h-auto",
        className,
      )}
    >
      {ANSWERS.map((a) => (
        <button
          key={a}
          type="button"
          aria-pressed={value === a}
          aria-disabled={rsvp.isPending || undefined}
          onClick={(event) => {
            if (rsvp.isPending) return;
            refocus.current = event.currentTarget === document.activeElement;
            answer(a);
          }}
          className="inline-flex cursor-pointer items-center justify-center px-3.5 text-body font-medium whitespace-nowrap text-foreground hover:bg-surface-hover focus-visible:-outline-offset-2 aria-pressed:bg-brand-subtle aria-pressed:text-brand-subtle-foreground aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground pointer-coarse:min-h-11 @max-[37.5rem]/meeting:min-h-11"
        >
          {t(ANSWER_LABEL[a])}
        </button>
      ))}
    </div>
  );
  const answeredLine = value ? (
    <span className="inline-flex items-center gap-1.5">
      {value === "ACCEPTED" ? <Check aria-hidden className="size-4 text-success" /> : null}
      <strong className="font-semibold">{t(`meetings.detail.scheduled.answered_${value}`)}</strong>
    </span>
  ) : null;

  if (variant === "phoneBar") {
    return (
      // The bar sizes its primaries at 44 (`*:h-11`); this one is a caption over a 44 control.
      <div className="flex h-auto! flex-col gap-2 pt-0.5">
        <div className="flex min-h-5 items-center gap-2 text-caption text-muted-foreground">
          {answeredLine ?? (
            <>
              <MeetingPersonAvatar name={hostName} size={20} tint={meetingAvatarTint(hostId, memberIndex.members)} />
              <span>
                <Trans
                  t={t}
                  i18nKey="meetings.detail.scheduled.invitedYouShort"
                  values={{ name: hostName }}
                  components={{ b: <b className="font-medium text-foreground" /> }}
                />
              </span>
            </>
          )}
        </div>
        {control("h-11 w-full [&>button]:min-w-27.5 [&>button]:flex-1 [&>button]:px-2")}
      </div>
    );
  }

  const day = dayWord(meeting.starts_at, now, t) ?? shortDay(meeting.starts_at, now, t);
  // In person no room opens (spec D4): the line says when the meeting starts.
  const inPerson = meetingVenue(meeting) === "in_person";
  // The strip sets the hour in its own <time> (ScheduledMember); the phone room row is one plain caption.
  const hour = isPhone ? <Fragment /> : <time dateTime={meeting.starts_at} className="tabular-nums" />;
  const opens = (
    <Trans
      t={t}
      i18nKey={inPerson ? "meetings.detail.strip.startsAt" : "meetings.detail.scheduled.roomOpens"}
      values={{ time: clock(meeting.starts_at), day }}
      components={inPerson ? { t: hour } : { time: hour }}
    />
  );
  const calendar = (
    <MeetingCalendarButton
      meetingId={meeting.id}
      title={meeting.title}
      className={cn(kitButton.base, kitButton.ghost)}
    />
  );

  if (isPhone) {
    // The answer lives in the bottom bar; the strip keeps the room row (PhoneScheduled `.room`).
    return (
      <StripRow className="py-3">
        <div aria-label={inPerson ? undefined : t("meetings.detail.scheduled.roomLabel")} role={inPerson ? undefined : "group"} className="w-full">
          <p className="text-caption text-muted-foreground">{opens}</p>
          {actions ? (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2 *:h-11 [&>*:first-child]:w-full">
              {actions}
              {calendar}
            </div>
          ) : (
            <div className="mt-2 flex *:h-11">{calendar}</div>
          )}
        </div>
      </StripRow>
    );
  }

  // Asking until the server holds the answer, so the control (and focus in it) stays while it saves.
  const asking = !value || changing || rsvp.isPending;
  return (
    <StripRow>
      <div className="grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 @max-[42.5rem]/meeting:grid-cols-[32px_minmax(0,1fr)]">
        <MeetingPersonAvatar
          name={hostName}
          size={32}
          tint={meetingAvatarTint(hostId, memberIndex.members)}
          className="row-span-2 self-center @max-[42.5rem]/meeting:row-span-1"
        />
        <div className="row-span-2 min-w-0 text-body @max-[42.5rem]/meeting:row-span-1">
          {asking ? (
            <p>
              <strong className="font-semibold">{t("meetings.detail.scheduled.invitedYou", { name: hostName })}</strong>
            </p>
          ) : (
            <p className="flex items-center gap-1.5">
              {answeredLine}
              <span aria-hidden>·</span>
              <TextButton
                ref={changeButton}
                aria-label={t("meetings.detail.scheduled.changeLabel")}
                className="py-0 text-body"
                onClick={() => setChanging(true)}
              >
                {t("meetings.detail.scheduled.change")}
              </TextButton>
            </p>
          )}
          <p className="mt-0.5 text-caption text-muted-foreground">{opens}</p>
        </div>
        {asking
          ? control(
              "col-start-3 row-start-1 ml-3 h-9 justify-self-end @max-[42.5rem]/meeting:col-span-2 @max-[42.5rem]/meeting:col-start-1 @max-[42.5rem]/meeting:row-start-auto @max-[42.5rem]/meeting:ml-0 @max-[42.5rem]/meeting:h-11 @max-[42.5rem]/meeting:justify-self-stretch [&>button]:flex-1",
            )
          : null}
        <div className="col-start-3 row-start-2 ml-3 flex items-center gap-2 justify-self-end @max-[42.5rem]/meeting:col-span-2 @max-[42.5rem]/meeting:col-start-1 @max-[42.5rem]/meeting:row-start-auto @max-[42.5rem]/meeting:ml-0">
          {calendar}
          {actions}
        </div>
      </div>
    </StripRow>
  );
}

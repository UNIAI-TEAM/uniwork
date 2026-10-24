"use client";
import { Check } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useRespondInvitation } from "@uniwork/core/meetings";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../../../layout/workspace-context";
import { toastApiError } from "../../../toast-api-error";
import { MeetingCalendarButton } from "../../meeting-calendar-button";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { clock, dayWord, shortDay } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { Segmented } from "../ui/segmented";
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

  const control = (className: string) => (
    <Segmented
      legend={t("meetings.detail.scheduled.answerLegend", { name: hostName })}
      options={ANSWERS.map((a) => ({ value: a, label: t(ANSWER_LABEL[a]) }))}
      value={value}
      onChange={answer}
      disabled={rsvp.isPending}
      className={cn("[&>label]:whitespace-nowrap", className)}
    />
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
        {control("h-11 w-full [&>label]:min-w-27.5 [&>label]:flex-1 [&>label]:px-2")}
      </div>
    );
  }

  const day = dayWord(meeting.starts_at, now, t) ?? shortDay(meeting.starts_at, now, t);
  // The strip sets the hour in its own <time> (ScheduledMember); the phone room row is one plain caption.
  const opens = (
    <Trans
      t={t}
      i18nKey="meetings.detail.scheduled.roomOpens"
      values={{ time: clock(meeting.starts_at), day }}
      components={{ time: isPhone ? <Fragment /> : <time dateTime={meeting.starts_at} className="tabular-nums" /> }}
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
        <div aria-label={t("meetings.detail.scheduled.roomLabel")} role="group" className="w-full">
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

  const asking = !value || changing;
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
              "col-start-3 row-start-1 ml-3 h-9 justify-self-end @max-[42.5rem]/meeting:col-span-2 @max-[42.5rem]/meeting:col-start-1 @max-[42.5rem]/meeting:row-start-auto @max-[42.5rem]/meeting:ml-0 @max-[42.5rem]/meeting:h-11 @max-[42.5rem]/meeting:justify-self-stretch [&>label]:flex-1",
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

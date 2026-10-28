"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarCheck, Clock, LogOut, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveInviteLink } from "@uniwork/core/api/endpoints/meetings";
import { paths } from "@uniwork/core/paths";
import { Logo } from "@uniwork/ui/brand";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale } from "../meeting-datetime";
import { inviteStorageKey } from "../meeting-invite-session";
import { MeetingInviteShell } from "../meeting-invite-shell";
import { MeetingPersonAvatar } from "../meeting-person";
import type { ExitMedia, RoomExit } from "./exit-model";
import { ExitHeading, ExitMark } from "./exit-shell";
import { tallySummary, type GuestTally } from "./use-guest-tally";

/** A guest outside the room learns the meeting ended only by asking: resolve is cheap and budgeted at 60/min. */
const RESOLVE_POLL_MS = 30_000;
const FACES = 2;

function GuestColumn({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[32.5rem] flex-col items-center gap-6 text-center">{children}</div>;
}

/** "Họp bằng [mark] UniWork · Dùng cho đội của bạn": the quiet footer of board G. */
function MadeWith() {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center justify-center gap-2 pt-4 text-label text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        {t("meetings.exit.guest.madeWith")}
        <Logo variant="mark" size={16} decorative />
        {t("meetings.exit.guest.brand")}
      </span>
      <span aria-hidden>·</span>
      <a href={paths.register()} className="text-primary hover:underline">
        {t("meetings.exit.guest.teamCta")}
      </a>
    </p>
  );
}

/** Board G: a guest left; the name and devices are kept for the way back in. */
export function GuestExitLeft({
  invite,
  meetingTitle,
  media,
  presence,
  rating,
  onRejoin,
  onChangeSetup,
  onEnded,
}: {
  invite?: { linkId: string; secret: string };
  meetingTitle?: string;
  media: ExitMedia;
  presence: (startedAt?: string) => ReactNode;
  rating: ReactNode;
  onRejoin: () => void;
  onChangeSetup: () => void;
  onEnded: (exit: RoomExit) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const [link, setLink] = useState<{ startsAt?: string; startedAt?: string }>({});
  const name = invite ? (sessionStorage.getItem(inviteStorageKey(invite.linkId, "displayName")) ?? "") : "";
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const linkId = invite?.linkId;
  const secret = invite?.secret;

  useEffect(() => {
    if (!linkId || !secret) return;
    let live = true;
    const ask = () =>
      resolveInviteLink(linkId, secret).then(
        (res) => {
          if (!live || !res) return;
          setLink({ startsAt: res.starts_at, startedAt: res.started_at });
          if (res.meeting_state === "ended") onEndedRef.current({ kind: "ended", at: new Date().toISOString() });
        },
        () => undefined,
      );
    void ask();
    const id = window.setInterval(() => void ask(), RESOLVE_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [linkId, secret]);

  // "Thứ Ba 27/10, 15:40": the day first, as the invite page writes it.
  const starts = link.startsAt ? new Date(link.startsAt) : null;
  const when = starts
    ? `${starts.toLocaleDateString(locale, { weekday: "long", day: "2-digit", month: "2-digit" }).replace(",", "")}, ${starts.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : null;
  const chip = (on: boolean, icon: ReactNode, label: string) => (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption [&_svg]:size-3",
        on ? "bg-brand-subtle text-brand-subtle-foreground" : "bg-surface-hover text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </span>
  );

  return (
    <MeetingInviteShell>
      <GuestColumn>
        <ExitMark>
          <LogOut aria-hidden />
        </ExitMark>
        <ExitHeading title={t("meetings.exit.left.title")}>
          <p className="text-body-lg text-muted-foreground">{[meetingTitle, when].filter(Boolean).join(" · ")}</p>
        </ExitHeading>
        {presence(link.startedAt)}
        <div className="flex w-full flex-col items-center gap-3">
          <Button type="button" size="lg" className="min-h-13 w-full max-w-[22.5rem] rounded-xl text-body-lg font-semibold" onClick={onRejoin}>
            <Video aria-hidden className="size-4" />
            {t("meetings.exit.rejoin")}
          </Button>
          <div role="group" aria-label={t("meetings.exit.mediaGroup")} className="flex flex-wrap justify-center gap-2">
            {name ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover py-1 pr-2.5 pl-1 text-caption text-foreground">
                <MeetingPersonAvatar name={name} size={18} />
                {name}
              </span>
            ) : null}
            {chip(media.audio, media.audio ? <Mic aria-hidden /> : <MicOff aria-hidden />, t(media.audio ? "meetings.exit.micOn" : "meetings.exit.micOff"))}
            {chip(media.video, media.video ? <Video aria-hidden /> : <VideoOff aria-hidden />, t(media.video ? "meetings.exit.camOn" : "meetings.exit.camOff"))}
          </div>
          <Button type="button" variant="link" className="min-h-11" onClick={onChangeSetup}>
            {t("meetings.exit.guest.changeSetup")}
          </Button>
        </div>
        <div aria-hidden className="h-px w-full bg-border" />
        {rating}
        <MadeWith />
      </GuestColumn>
    </MeetingInviteShell>
  );
}

/** Board H: the meeting ended around a guest; no minutes are promised (owner's call, 2026-10-27). */
export function GuestExitEnded({
  meetingTitle,
  at,
  tally,
  rating,
}: {
  meetingTitle?: string;
  at: string;
  tally?: GuestTally;
  rating: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const time = new Date(at).toLocaleTimeString(meetingLocale(i18n.language), { hour: "2-digit", minute: "2-digit", hour12: false });
  const visit = tally ? tallySummary(tally, Date.now()) : null;
  const shown = visit?.names.slice(0, FACES) ?? [];
  const more = (visit?.people ?? 0) - shown.length;
  return (
    <MeetingInviteShell>
      <GuestColumn>
        <ExitMark className="bg-success-soft text-success-soft-foreground ring-success/10">
          <CalendarCheck aria-hidden />
        </ExitMark>
        <ExitHeading title={t("meetings.exit.guest.thanks")}>
          <p className="text-body-lg text-muted-foreground">{t("meetings.exit.guest.endedAt", { time, title: meetingTitle ?? "" })}</p>
        </ExitHeading>
        {visit && (visit.minutes > 0 || visit.people > 0) ? (
          <div className="grid w-full grid-cols-2 gap-2.5">
            <div className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3.5 text-left">
              <Clock aria-hidden className="size-4 text-muted-foreground" />
              <span className="flex flex-col">
                <span className="text-body-lg font-semibold text-foreground">{t("meetings.exit.guest.minutes", { count: visit.minutes })}</span>
                <span className="text-caption text-muted-foreground">{t("meetings.exit.guest.minutesLabel")}</span>
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3.5 text-left">
              <span aria-hidden className="flex shrink-0 -space-x-1.5">
                {shown.map((n) => (
                  <MeetingPersonAvatar key={n} name={n} size={24} className="ring-2 ring-surface" />
                ))}
                {more > 0 ? (
                  <span className="flex size-6 items-center justify-center rounded-full bg-surface-hover text-micro font-semibold text-muted-foreground ring-2 ring-surface">
                    +{more}
                  </span>
                ) : null}
              </span>
              <span className="flex flex-col">
                <span className="text-body-lg font-semibold text-foreground">{t("meetings.exit.guest.people", { count: visit.people })}</span>
                <span className="text-caption text-muted-foreground">{t("meetings.exit.guest.peopleLabel")}</span>
              </span>
            </div>
          </div>
        ) : null}
        {rating}
        <div className="mt-4 flex w-full flex-wrap items-center gap-3 rounded-2xl border border-border px-4 py-4 text-left">
          <Logo variant="mark" size={26} decorative />
          <span className="min-w-0 flex-[1_1_12rem] text-label text-foreground">{t("meetings.exit.guest.pitch")}</span>
          <ButtonLink href={paths.register()} variant="outline" className="min-h-10 px-3">
            {t("meetings.exit.guest.tryCta")}
          </ButtonLink>
        </div>
      </GuestColumn>
    </MeetingInviteShell>
  );
}

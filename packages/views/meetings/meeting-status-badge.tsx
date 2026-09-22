"use client";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { useTranslation } from "react-i18next";

/**
 * The signal set every meeting state reads from — status, RSVP, invite link,
 * and the live row in the list and on Home. A state is a signal, never the
 * meetings violet: that tint only says "this is a meeting".
 */
export type MeetingTone = "info" | "success" | "warning" | "destructive" | "muted";

export const MEETING_TONE_BADGE: Record<MeetingTone, string> = {
  info: "bg-info-soft text-info-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  destructive: "bg-destructive-soft text-destructive-soft-foreground",
  muted: "bg-muted text-muted-foreground",
};

export const MEETING_STATUS_TONE: Record<string, MeetingTone> = {
  SCHEDULED: "info",
  IN_PROGRESS: "success",
  OVERTIME: "warning",
  MISSED: "muted",
  ENDED: "muted",
  CANCELED: "destructive",
};

const RSVP_TONE: Record<string, MeetingTone> = {
  PENDING: "muted",
  ACCEPTED: "success",
  DECLINED: "destructive",
  TENTATIVE: "warning",
};

const LINK_TONE: Record<"active" | "expired" | "revoked" | "limit_reached", MeetingTone> = {
  active: "success",
  expired: "muted",
  revoked: "destructive",
  limit_reached: "warning",
};

function ToneBadge({ tone, className, children }: { tone: MeetingTone; className?: string; children: React.ReactNode }) {
  return (
    <Badge data-tone={tone} className={cn(MEETING_TONE_BADGE[tone], className)}>
      {children}
    </Badge>
  );
}

export function MeetingStatusBadge({ status, className }: { status?: string; className?: string }) {
  const { t } = useTranslation();
  const key = status && status in MEETING_STATUS_TONE ? status : "SCHEDULED";
  const live = key === "IN_PROGRESS";
  return (
    <ToneBadge tone={MEETING_STATUS_TONE[key] ?? "info"} className={cn(live && "gap-1.5", className)}>
      {live ? (
        <span
          aria-hidden
          className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
        />
      ) : null}
      {t(`meetings.status_${key}`)}
    </ToneBadge>
  );
}

export function MeetingRsvpBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = status in RSVP_TONE ? status : "PENDING";
  return <ToneBadge tone={RSVP_TONE[key] ?? "muted"}>{t(`meetings.rsvp_${key}`)}</ToneBadge>;
}

export function MeetingLinkBadge({ status }: { status: "active" | "expired" | "revoked" | "limit_reached" }) {
  const { t } = useTranslation();
  return <ToneBadge tone={LINK_TONE[status]}>{t(`meetings.link_${status}`)}</ToneBadge>;
}

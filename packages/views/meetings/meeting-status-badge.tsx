"use client";
import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "default",
  ENDED: "secondary",
  CANCELED: "destructive",
};

export function MeetingStatusBadge({ status, className }: { status?: string; className?: string }) {
  const { t } = useTranslation();
  const key = status && status in STATUS_VARIANT ? status : "SCHEDULED";
  return (
    <Badge variant={STATUS_VARIANT[key]} className={className}>
      {t(`meetings.status_${key}`)}
    </Badge>
  );
}

const RSVP_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline",
  ACCEPTED: "default",
  DECLINED: "destructive",
  TENTATIVE: "secondary",
};

export function MeetingRsvpBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const key = status in RSVP_VARIANT ? status : "PENDING";
  return <Badge variant={RSVP_VARIANT[key]}>{t(`meetings.rsvp_${key}`)}</Badge>;
}

const LINK_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  expired: "secondary",
  revoked: "destructive",
  limit_reached: "outline",
};

export function MeetingLinkBadge({ status }: { status: "active" | "expired" | "revoked" | "limit_reached" }) {
  const { t } = useTranslation();
  return <Badge variant={LINK_VARIANT[status]}>{t(`meetings.link_${status}`)}</Badge>;
}

"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../agents/agent-badge";
import type { MeetingParticipantRole } from "./meeting-signals";

const CHIP = "h-4 px-1.5 text-micro";

/**
 * Who a participant is, beside their name: an agent carries the product's one
 * agent badge (ADR 0007), a guest from an invite link carries "Guest", and a
 * formal meeting marks its secretary and its observers.
 */
export function MeetingRoleChip({
  role,
  className,
}: {
  role: MeetingParticipantRole;
  className?: string;
}) {
  const { t } = useTranslation();
  if (role === "agent") return <AgentBadge className={cn(CHIP, className)} />;
  const label =
    role === "secretary"
      ? t("meetings.governance.secretary")
      : role === "observer"
        ? t("meetings.governance.standing_OBSERVER")
        : t("meetings.guest");
  // The secretary holds a duty, so it is filled; standing and guest stay outlined.
  return (
    <Badge
      variant="outline"
      className={cn(
        CHIP,
        role === "secretary" && "border-transparent bg-brand-subtle text-brand-subtle-foreground",
        role === "observer" && "text-muted-foreground",
        className,
      )}
    >
      {label}
    </Badge>
  );
}

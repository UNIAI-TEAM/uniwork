"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { cn } from "@uniwork/ui/lib/utils";
import { AgentBadge } from "../agents/agent-badge";
import type { MeetingParticipantRole } from "./meeting-signals";

const CHIP = "h-4 px-1.5 text-micro";

/**
 * Who a participant is, beside their name: an agent carries the product's one
 * agent badge (ADR 0007), a guest from an invite link carries "Guest".
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
  return (
    <Badge variant="outline" className={cn(CHIP, className)}>
      {t("meetings.guestBadge")}
    </Badge>
  );
}

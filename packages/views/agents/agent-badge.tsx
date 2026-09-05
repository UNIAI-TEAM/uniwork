"use client";
import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";

/**
 * The one way an agent is marked in the UI (ADR 0007 §4). Render it next to
 * any actor whose `kind` is "agent" — assignee, comment author, activity —
 * and nowhere else; never draw a lookalike by hand.
 */
export function AgentBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary" className={className}>
      {t("agents.badge")}
    </Badge>
  );
}

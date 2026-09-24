"use client";

import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

/**
 * Q&A over the meeting is on the roadmap, not in the product: one locked row
 * with the "coming soon" label, no input that looks usable (PRODUCT.md,
 * Operating Context).
 */
export function MeetingCopilotFooter() {
  const { t } = useTranslation();

  return (
    <div
      className="mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-label text-muted-foreground"
      data-testid="meeting-copilot-ask-locked"
    >
      <Lock aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t("meetings.askAboutMeeting")}</span>
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-micro font-semibold text-muted-foreground">
        {t("meetings.comingSoon")}
      </span>
    </div>
  );
}

export function MeetingCopilotTasksCta({
  disabled,
  pending,
  count,
  onClick,
}: {
  disabled?: boolean;
  pending?: boolean;
  count: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  if (count <= 0) return null;

  return (
    <Button
      type="button"
      variant="brand"
      className="mt-3 w-full"
      disabled={disabled || pending}
      onClick={onClick}
    >
      {t("meetings.createTasksInUniwork", { count })}
    </Button>
  );
}

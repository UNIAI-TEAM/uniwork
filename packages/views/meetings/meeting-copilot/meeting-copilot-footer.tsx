"use client";

import { Send, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";

export function MeetingCopilotFooter() {
  const { t } = useTranslation();

  return (
    <div className="mt-3 shrink-0 rounded-xl border border-border bg-muted/40 p-3 dark:border-input dark:bg-secondary/60">
      <p className="flex items-center gap-1.5 text-label font-medium text-foreground">
        <Sparkles aria-hidden className="size-3.5 text-brand" />
        {t("meetings.askAiCopilot")}
      </p>
      <form
        className="relative mt-2"
        onSubmit={(e) => {
          e.preventDefault();
        }}
      >
        <Input
          disabled
          placeholder={t("meetings.askAiCopilotPlaceholder")}
          className="bg-background pr-10 dark:bg-background"
          aria-describedby="copilot-soon-hint"
        />
        <Button
          type="submit"
          size="icon-sm"
          variant="ghost"
          disabled
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
          aria-label={t("meetings.send")}
        >
          <Send aria-hidden className="size-4" />
        </Button>
      </form>
      <p id="copilot-soon-hint" className="mt-1.5 text-caption text-muted-foreground">
        {t("meetings.askAiCopilotSoon")}
      </p>
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

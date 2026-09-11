"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";

export function MeetingCopilotHeader({
  canHost,
  aiOn,
  hasSource,
  hasSummary,
  generating,
  onGenerate,
}: {
  canHost: boolean;
  aiOn: boolean;
  hasSource: boolean;
  hasSummary: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-start justify-between gap-2 pb-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Sparkles aria-hidden className="size-4 shrink-0 text-brand" />
        <h2 className="text-pretty text-title-sm font-semibold text-foreground">
          {t("meetings.uniworkAi")}
        </h2>
        <Badge variant="secondary" className="border-brand/20 bg-surface-selected text-brand">
          {t("meetings.betaLabel")}
        </Badge>
      </div>
      {canHost && aiOn ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={generating || !hasSource}
          onClick={onGenerate}
        >
          {generating
            ? t("meetings.summarizing")
            : hasSummary
              ? t("meetings.regenerateSummary")
              : t("meetings.generateSummary")}
        </Button>
      ) : null}
    </div>
  );
}

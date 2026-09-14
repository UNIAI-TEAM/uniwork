"use client";

import { useMemo } from "react";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildHomeBrief } from "@uniwork/core/home/brief";
import type { HomeSummary } from "@uniwork/core/types/home";
import { PanelCard } from "../common/panel-card";

/**
 * A few sentences derived from the summary itself — no model, no invented
 * numbers. With nothing to say the section is absent rather than a line of zeros.
 */
export function HomeBrief({ summary }: { summary: HomeSummary }) {
  const { t } = useTranslation();
  const lines = useMemo(() => buildHomeBrief(summary), [summary]);
  if (lines.length === 0) return null;
  return (
    <PanelCard
      id="home-brief"
      title={t("home.brief.title")}
      icon={ClipboardList}
      action={
        <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">{t("home.brief.badge")}</span>
      }
    >
      <ol className="space-y-2">
        {lines.map((line, i) => (
          <li key={line.key} className="flex gap-2 text-body text-foreground">
            <span aria-hidden className="w-4 shrink-0 text-caption leading-6 text-muted-foreground tabular-nums">
              {i + 1}.
            </span>
            <span>{t(line.key, line.params)}</span>
          </li>
        ))}
      </ol>
    </PanelCard>
  );
}

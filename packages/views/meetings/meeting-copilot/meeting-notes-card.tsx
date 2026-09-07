"use client";

import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { MeetingPanelCard } from "../meeting-panel-card";

function summaryLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}

export function MeetingNotesCard({
  summary,
  decisions,
  summaryUpdatedAt,
  summarizing,
  emptyHint,
}: {
  summary?: string;
  decisions: readonly string[];
  summaryUpdatedAt?: string | null;
  summarizing?: boolean;
  emptyHint: string;
}) {
  const { t } = useTranslation();
  const lines = summary ? summaryLines(summary) : [];
  const copyText = [
    summary ? `${t("meetings.summaryTab")}:\n${lines.map((l) => `- ${l}`).join("\n")}` : "",
    decisions.length > 0
      ? `${t("meetings.decisions")}:\n${decisions.map((d) => `- ${d}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const onCopy = async () => {
    if (!copyText.trim()) return;
    try {
      await navigator.clipboard.writeText(copyText);
      toast.success(t("meetings.copyNotes"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  return (
    <MeetingPanelCard
      id="meeting-notes-card"
      title={t("meetings.meetingNotes")}
      action={
        copyText ? (
          <Button type="button" size="sm" variant="ghost" className="h-8 gap-1.5 px-2" onClick={() => void onCopy()}>
            <Copy aria-hidden className="size-3.5" />
            {t("meetings.copyNotes")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-caption font-medium text-foreground">{t("meetings.summaryTab")}</h3>
            {summarizing ? (
              <span className="text-caption text-success">{t("meetings.summarizing")}</span>
            ) : summaryUpdatedAt ? (
              <span className="text-caption text-muted-foreground">
                {t("meetings.summaryUpdated", { time: summaryUpdatedAt })}
              </span>
            ) : null}
          </div>
          {lines.length > 0 ? (
            <p className="text-pretty text-body text-muted-foreground">{lines[0]}</p>
          ) : (
            <p className="text-label text-muted-foreground">{emptyHint}</p>
          )}
        </section>

        {lines.length > 1 ? (
          <section className="space-y-2">
            <h3 className="text-caption font-medium text-foreground">{t("meetings.keyPoints")}</h3>
            <ul className="space-y-1.5">
              {lines.slice(1).map((line, i) => (
                <li key={i} className="flex gap-2 text-body text-foreground">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
                  <span className="text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {decisions.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-caption font-medium text-foreground">{t("meetings.decisions")}</h3>
            <ul className="space-y-1.5">
              {decisions.map((d, i) => (
                <li key={i} className="flex gap-2 text-body text-foreground">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span className="text-pretty">{d}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </MeetingPanelCard>
  );
}

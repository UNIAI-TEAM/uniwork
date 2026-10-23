"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ListChecks, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubThreadSummary } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";

const LIST_SUMMARY_PREVIEW_LEN = 220;

function EmailHubAiInsightShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function EmailHubAiInsightHeader({ cardOpen, onToggleCard }: { cardOpen: boolean; onToggleCard: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={cn(
        "-mx-1.5 flex min-h-10 w-[calc(100%+0.75rem)] items-center gap-2 rounded-control px-1.5 transition-colors duration-(--duration-fast) hover:bg-muted",
        cardOpen && "mb-2",
      )}
      aria-expanded={cardOpen}
      onClick={onToggleCard}
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand-subtle-foreground">
        <Sparkles className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left text-body font-semibold text-foreground">
        {t("email_hub.ai.list_badge")}
      </span>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast)",
          !cardOpen && "-rotate-90",
        )}
        aria-hidden
      />
    </button>
  );
}

export function EmailHubListAiSummary({
  analyzing,
  listSummary,
}: {
  analyzing?: boolean;
  listSummary?: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [listSummary]);

  if (!analyzing && !listSummary) return null;

  const long = Boolean(listSummary && listSummary.length > LIST_SUMMARY_PREVIEW_LEN);
  const preview =
    listSummary && !expanded && long
      ? `${listSummary.slice(0, LIST_SUMMARY_PREVIEW_LEN).trimEnd()}…`
      : listSummary;
  const body =
    analyzing && !listSummary ? t("email_hub.ai.analyzing") : preview ?? "";

  return (
    <div className="px-3 pb-2.5 lg:px-4">
    <div
      className={cn(
        "ml-21 flex gap-2 pointer-coarse:ml-24 rounded-lg border border-border bg-surface px-2.5 py-2",
        analyzing && !listSummary && "border-dashed",
      )}
      role={analyzing && !listSummary ? "status" : undefined}
    >
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center text-brand-subtle-foreground" aria-hidden>
        {analyzing && !listSummary ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-caption leading-snug text-muted-foreground",
            expanded ? "whitespace-pre-wrap" : "line-clamp-2",
          )}
        >
          {body}
        </p>
        {long && listSummary ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-0.5 -ml-1.5 gap-1 px-1.5 text-caption font-medium text-brand-subtle-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? t("email_hub.ai.list_collapse") : t("email_hub.ai.list_expand")}
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
    </div>
  );
}

/** "18:59, 24 thg 9" — when UNI wrote this, so a stale summary reads as stale. */
function generatedAt(iso: string, language: string) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(language.startsWith("en") ? "en-US" : "vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(d);
}

export function EmailHubAiSummaryDetail({ summary }: { summary: EmailHubThreadSummary }) {
  const { t, i18n } = useTranslation();
  const when = generatedAt(summary.summarized_at, i18n.language);
  const actionCount = summary.action_items.length;
  const [cardOpen, setCardOpen] = useState(true);

  return (
    <EmailHubAiInsightShell>
      <EmailHubAiInsightHeader cardOpen={cardOpen} onToggleCard={() => setCardOpen((v) => !v)} />
      {cardOpen ? (
        <>
          <p className="mb-2 text-caption text-muted-foreground">
            {when ? t("email_hub.ai.generated_at", { when }) : t("email_hub.ai.generated_by")}
          </p>
          <p className="text-body leading-relaxed text-foreground">{summary.summary}</p>
          {summary.key_points.length > 0 ? (
            <ul className="mt-3 space-y-2 border-t border-border pt-3">
              {summary.key_points.map((point) => (
                <li key={point} className="flex gap-2 text-body leading-snug text-muted-foreground">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.needs_reply && summary.reply_hint ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2.5">
              <p className="text-overline text-muted-foreground">{t("email_hub.ai.reply_hint_label")}</p>
              <p className="mt-1 text-body leading-snug text-foreground">{summary.reply_hint}</p>
            </div>
          ) : null}
          {actionCount > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <ListChecks className="size-3.5 shrink-0" aria-hidden />
              {t("email_hub.ai.action_items_count", { count: actionCount })}
            </p>
          ) : null}
        </>
      ) : null}
    </EmailHubAiInsightShell>
  );
}

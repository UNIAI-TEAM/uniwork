"use client";

import { Plus, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { formatWhen, StatRow, StatsCard } from "./email-hub-view-parts";

interface EmailHubStatsRailProps {
  readingEmail: boolean;
  counts: { total: number; unread: number };
  activeAccount?: EmailHubAccount;
  accountList: EmailHubAccount[];
  accountId: string | null;
  onSelectAccount: (id: string) => void;
  onConnect: () => void;
}

export function EmailHubStatsRail({
  readingEmail,
  counts,
  activeAccount,
  accountList,
  accountId,
  onSelectAccount,
  onConnect,
}: EmailHubStatsRailProps) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "hidden w-60 shrink-0 flex-col border-l border-border bg-sidebar xl:flex",
        readingEmail && "xl:hidden 2xl:flex",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-brand" />
        <span className="text-body font-medium">{t("email_hub.ai_title")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <StatsCard title={t("email_hub.stats.summary")}>
            <StatRow label={t("email_hub.stats.total")} value={counts.total} />
            <StatRow label={t("email_hub.stats.unread")} value={counts.unread} />
            <StatRow label={t("email_hub.stats.read")} value={Math.max(0, counts.total - counts.unread)} />
          </StatsCard>
          <StatsCard title={t("email_hub.stats.priority")}>
            {counts.unread > 0 ? (
              <p className="text-body">{t("email_hub.list_count", { count: counts.total, unread: counts.unread })}</p>
            ) : (
              <p className="text-caption text-muted-foreground">{t("email_hub.stats.priority_empty")}</p>
            )}
          </StatsCard>
          <StatsCard title={t("email_hub.stats.inbox")}>
            <p className="text-caption text-muted-foreground">{t("email_hub.stats.inbox_hint")}</p>
            {activeAccount?.last_sync_at ? (
              <p className="mt-2 text-caption text-muted-foreground">
                {t("email_hub.stats.last_sync")}: {formatWhen(activeAccount.last_sync_at)}
              </p>
            ) : null}
          </StatsCard>
        </div>
      </div>
      <div className="border-t border-border p-4">
        <StatsCard title={t("email_hub.connect_section")}>
          {accountList.length === 0 ? (
            <p className="mb-3 text-caption text-muted-foreground">{t("email_hub.connect_section_empty")}</p>
          ) : (
            <ul className="mb-3 space-y-1">
              {accountList.map((acc) => (
                <li key={acc.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full truncate rounded-md px-2 py-1.5 text-left text-caption hover:bg-muted/50",
                      accountId === acc.id && "bg-surface-selected text-brand",
                    )}
                    onClick={() => onSelectAccount(acc.id)}
                  >
                    {acc.email_address}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" className="w-full gap-1" onClick={onConnect}>
            <Plus className="size-3.5" />
            {t("email_hub.add_account")}
          </Button>
        </StatsCard>
      </div>
    </aside>
  );
}

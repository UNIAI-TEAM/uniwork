"use client";

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import { cn } from "@uniwork/ui/lib/utils";
import { EmailHubAccountsPanel } from "./email-hub-accounts-panel";
import { formatWhen, StatRow, StatsCard } from "./email-hub-view-parts";

interface EmailHubStatsRailProps {
  readingEmail: boolean;
  counts: { total: number; unread: number };
  accounts: EmailHubAccount[];
  activeAccountId: string | null;
  disconnectPending: boolean;
  onSelectAccount: (accountId: string) => void;
  onDisconnect: (accountId: string) => void;
  onAddAccount: () => void;
  activeAccount?: EmailHubAccount;
}

export function EmailHubStatsRail({
  readingEmail,
  counts,
  accounts,
  activeAccountId,
  disconnectPending,
  onSelectAccount,
  onDisconnect,
  onAddAccount,
  activeAccount,
}: EmailHubStatsRailProps) {
  const { t } = useTranslation();
  const readCount = Math.max(0, counts.total - counts.unread);
  return (
    <aside
      className={cn(
        "hidden h-full min-h-0 w-64 shrink-0 flex-col border-l border-border bg-sidebar lg:flex",
        readingEmail && "lg:hidden",
      )}
    >
      <div className="border-b border-border bg-brand/5 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-brand/10">
            <Sparkles className="size-4 text-brand" />
          </span>
          <div>
            <span className="block text-body font-semibold">{t("email_hub.ai_title")}</span>
            <span className="text-caption text-muted-foreground">{t("email_hub.subtitle")}</span>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          <StatsCard title={t("email_hub.stats.summary")}>
            <StatRow label={t("email_hub.stats.total")} value={counts.total} />
            <StatRow label={t("email_hub.stats.unread")} value={counts.unread} />
            <StatRow label={t("email_hub.stats.read")} value={readCount} />
          </StatsCard>

          <StatsCard title={t("email_hub.stats.inbox")}>
            <p className="text-caption leading-relaxed text-muted-foreground">{t("email_hub.stats.inbox_hint")}</p>
            {activeAccount?.last_sync_at ? (
              <p className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-caption text-muted-foreground">
                {t("email_hub.stats.last_sync")}: {formatWhen(activeAccount.last_sync_at)}
              </p>
            ) : null}
          </StatsCard>
        </div>
      </div>

      <div className="mt-auto shrink-0 border-t border-border px-4 py-4">
        <EmailHubAccountsPanel
          accounts={accounts}
          activeAccountId={activeAccountId}
          disconnectPending={disconnectPending}
          onSelectAccount={onSelectAccount}
          onDisconnect={onDisconnect}
          onAddAccount={onAddAccount}
        />
      </div>
    </aside>
  );
}

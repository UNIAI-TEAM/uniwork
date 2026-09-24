"use client";

import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { emailHubAccountRowClass, emailHubIconActionClass } from "./email-hub-ui";

interface EmailHubAccountsPanelProps {
  accounts: EmailHubAccount[];
  activeAccountId: string | null;
  disconnectPending: boolean;
  onSelectAccount: (accountId: string) => void;
  onDisconnect: (accountId: string) => void;
  onAddAccount: () => void;
  className?: string;
}

export function EmailHubAccountsPanel({
  accounts,
  activeAccountId,
  disconnectPending,
  onSelectAccount,
  onDisconnect,
  onAddAccount,
  className,
}: EmailHubAccountsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("space-y-2", className)}>
      <p className="px-1 text-caption font-medium uppercase tracking-wide text-muted-foreground">
        {t("email_hub.accounts")}
      </p>
      {accounts.length ? (
        <ul className="space-y-1">
          {accounts.map((acc) => (
            <li key={acc.id} className="flex items-center gap-1">
              <button
                type="button"
                className={emailHubAccountRowClass(activeAccountId === acc.id)}
                onClick={() => onSelectAccount(acc.id)}
              >
                {acc.email_address}
              </button>
              <button
                type="button"
                className={cn(emailHubIconActionClass, "hover:text-destructive")}
                aria-label={t("email_hub.disconnect")}
                disabled={disconnectPending}
                onClick={() => onDisconnect(acc.id)}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-caption text-muted-foreground">{t("email_hub.no_accounts")}</p>
      )}
      <Button variant="toolbar" className="h-9 w-full gap-1.5 text-caption shadow-none" onClick={onAddAccount}>
        <Plus className="size-3.5" aria-hidden />
        {t("email_hub.add_account")}
      </Button>
    </div>
  );
}

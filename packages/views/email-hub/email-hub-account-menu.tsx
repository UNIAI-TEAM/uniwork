"use client";

import { useState } from "react";
import { ChevronsUpDown, Plus, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { ConfirmDialog } from "../common/form-dialog";
import { EmailSenderAvatar } from "./email-hub-view-parts";

export interface EmailHubAccountMenuProps {
  accounts: EmailHubAccount[];
  activeAccountId: string | null;
  disconnectPending: boolean;
  onSelectAccount: (accountId: string) => void;
  onDisconnect: (accountId: string, onDone: () => void) => void;
  onAddAccount: () => void;
}

/**
 * The mailbox in use, and the place to switch, add or disconnect one. It used
 * to be a list pinned under the AI rail whose trash icon disconnected a mailbox
 * on a single click, with no way back short of re-entering the app password.
 */
export function EmailHubAccountMenu({
  accounts,
  activeAccountId,
  disconnectPending,
  onSelectAccount,
  onDisconnect,
  onAddAccount,
  className,
  compact = false,
}: EmailHubAccountMenuProps & { className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const active = accounts.find((acc) => acc.id === activeAccountId) ?? null;
  const confirming = accounts.find((acc) => acc.id === confirmId) ?? null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "flex min-h-10 min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-(--duration-fast) hover:bg-muted aria-expanded:bg-muted pointer-coarse:min-h-11",
            compact ? "justify-center px-1.5" : "w-full",
            className,
          )}
          aria-label={t("email_hub.account_menu", { email: active?.email_address ?? "" })}
        >
          {active ? (
            <EmailSenderAvatar fromAddr={active.email_address} className="size-7 text-caption" />
          ) : null}
          {compact ? null : (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-foreground">
                  {active?.email_address ?? t("email_hub.no_accounts")}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("email_hub.accounts")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activeAccountId ?? ""}
              onValueChange={(value) => {
                if (typeof value === "string" && value) onSelectAccount(value);
              }}
            >
              {accounts.map((acc) => (
                <DropdownMenuRadioItem key={acc.id} value={acc.id}>
                  <span className="truncate">{acc.email_address}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAddAccount}>
            <Plus aria-hidden />
            {t("email_hub.add_account")}
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmId(active.id)}>
              <Unplug aria-hidden />
              {t("email_hub.disconnect_named", { email: active.email_address })}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open && !disconnectPending) setConfirmId(null);
        }}
        title={t("email_hub.disconnect_confirm_title", { email: confirming?.email_address ?? "" })}
        description={t("email_hub.disconnect_confirm_body")}
        confirmLabel={t("email_hub.disconnect")}
        pending={disconnectPending}
        onConfirm={() => {
          if (confirming) onDisconnect(confirming.id, () => setConfirmId(null));
        }}
      />
    </>
  );
}

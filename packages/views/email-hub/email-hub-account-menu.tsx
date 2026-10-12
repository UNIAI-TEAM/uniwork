"use client";

import { useState } from "react";
import { ChevronsUpDown, CircleAlert, Mail, Plus, RefreshCw, Server, Unplug } from "lucide-react";
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
import { SignInMark } from "../common/provider-icons";
import { EmailSenderAvatar } from "./email-hub-view-parts";

export interface EmailHubAccountMenuProps {
  accounts: EmailHubAccount[];
  activeAccountId: string | null;
  disconnectPending: boolean;
  onSelectAccount: (accountId: string) => void;
  onDisconnect: (accountId: string, onDone: () => void) => void;
  onAddAccount: () => void;
  onReconnect: (accountId: string) => void;
}

/** How the mailbox signs in, at a glance: the account's provider for OAuth, a server for an own domain, else mail. */
function AccountMark({ account }: { account: EmailHubAccount }) {
  switch (account.auth_kind) {
    case "oauth_google":
      return <span data-account-mark="google" className="inline-flex"><SignInMark provider="google" className="size-4" /></span>;
    case "oauth_microsoft":
      return <span data-account-mark="microsoft" className="inline-flex"><SignInMark provider="microsoft" className="size-4" /></span>;
    default:
      return account.provider === "custom" ? (
        <Server data-account-mark="server" className="text-muted-foreground" aria-hidden />
      ) : (
        <Mail data-account-mark="mail" className="text-muted-foreground" aria-hidden />
      );
  }
}

/**
 * Where focus goes after a connect closed the dialog: the account menu trigger on screen (the sidebar's at lg, the
 * list header's below it), else the list heading. A hidden trigger cannot take focus.
 */
export function focusTargetAfterConnect(): HTMLElement | null {
  const triggers = Array.from(document.querySelectorAll<HTMLElement>("[data-email-hub-account-trigger]"));
  return (
    triggers.find((el) => el.getClientRects().length > 0) ??
    document.querySelector<HTMLElement>("[data-email-hub-list-heading]")
  );
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
  onReconnect,
  className,
  compact = false,
}: EmailHubAccountMenuProps & { className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const active = accounts.find((acc) => acc.id === activeAccountId) ?? null;
  const confirming = accounts.find((acc) => acc.id === confirmId) ?? null;
  const broken = accounts.filter((acc) => acc.needs_reconnect);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-email-hub-account-trigger=""
          className={cn(
            "flex min-h-10 min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-(--duration-fast) hover:bg-muted aria-expanded:bg-muted pointer-coarse:min-h-11",
            compact ? "justify-center px-1.5" : "w-full",
            className,
          )}
          // The dot stands for any broken mailbox, not only the one in use: the label says which, or how many.
          aria-label={
            broken.length === 0
              ? t("email_hub.account_menu", { email: active?.email_address ?? "" })
              : broken.length === 1 && active?.needs_reconnect
                ? t("email_hub.account_menu_needs_reconnect", { email: active.email_address })
                : t("email_hub.account_menu_broken", { email: active?.email_address ?? "", count: broken.length })
          }
        >
          {active ? (
            <span className="relative inline-flex shrink-0">
              <EmailSenderAvatar fromAddr={active.email_address} className="size-7 text-caption" />
              {broken.length > 0 ? (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-warning-solid ring-2 ring-background"
                />
              ) : null}
            </span>
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
                  <AccountMark account={acc} />
                  <span className="truncate">{acc.email_address}</span>
                  {acc.needs_reconnect ? (
                    <span className="ml-auto inline-flex" title={t("email_hub.reconnect.badge")}>
                      <CircleAlert className="text-warning" aria-hidden />
                      <span className="sr-only">{t("email_hub.reconnect.badge")}</span>
                    </span>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {broken.map((acc) => (
            <DropdownMenuItem key={acc.id} onClick={() => onReconnect(acc.id)}>
              <RefreshCw aria-hidden />
              {t("email_hub.reconnect.menu", { email: acc.email_address })}
            </DropdownMenuItem>
          ))}
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

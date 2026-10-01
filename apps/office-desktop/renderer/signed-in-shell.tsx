import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Logo } from "@uniwork/ui/brand";
import type { ReactNode } from "react";

export interface SignedInShellProps {
  onSignOut: () => void;
  accountName?: string;
  accountEmail?: string;
  workspaceName?: string;
  onSwitchWorkspace?: () => void;
  children: ReactNode;
}

/** The desktop shell chrome: wordmark, sign-out, and the current screen
 * (the deployment/workspace picker, the library, or an open document). */
export function SignedInShell({ onSignOut, accountName, accountEmail, workspaceName, onSwitchWorkspace, children }: SignedInShellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.login" });
  const displayName = accountName?.trim() || t("accountUnknown");
  const initials = displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-host="office-desktop" data-session-status="signed-in">
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3"><Logo variant="lockup" size={22} /><Button variant="ghost" aria-label={t("switchWorkspace")} onClick={onSwitchWorkspace}>{workspaceName ?? t("libraryWorkspace")}</Button></div>
        <details className="relative"><summary className="flex cursor-pointer list-none items-center gap-2 rounded-control px-3 py-2 text-label text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Avatar size="sm" aria-hidden="true"><AvatarFallback>{initials}</AvatarFallback></Avatar><span>{displayName}</span></summary><div className="absolute right-0 z-10 mt-2 min-w-52 rounded-lg border border-border bg-surface p-3 shadow-lg"><p className="break-words text-label font-medium text-foreground">{displayName}</p>{accountEmail ? <p className="break-words text-caption text-muted-foreground">{accountEmail}</p> : null}<Button type="button" variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={onSignOut}>{t("signOut")}</Button></div></details>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

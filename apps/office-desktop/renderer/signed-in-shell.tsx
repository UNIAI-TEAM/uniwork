import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Logo } from "@uniwork/ui/brand";
import type { ReactNode } from "react";

export interface SignedInShellProps {
  onSignOut: () => void;
  accountName?: string;
  accountEmail?: string;
  workspaceName?: string;
  children: ReactNode;
}

/** The desktop shell chrome: wordmark, sign-out, and the current screen
 * (the deployment/workspace picker, the library, or an open document). */
export function SignedInShell({ onSignOut, accountName = "UniWork account", accountEmail, workspaceName, children }: SignedInShellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.login" });
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-host="office-desktop" data-session-status="signed-in">
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-3"><Logo variant="lockup" size={22} /><span className="truncate text-label text-muted-foreground">{workspaceName ?? t("libraryWorkspace")}</span></div>
        <details className="relative"><summary className="cursor-pointer list-none rounded-control px-3 py-2 text-label text-foreground focus-visible:outline-2 focus-visible:outline-ring">{accountName}</summary><div className="absolute right-0 z-10 mt-2 min-w-52 rounded-lg border border-border bg-surface p-3 shadow-lg"><p className="break-words text-label font-medium text-foreground">{accountName}</p>{accountEmail ? <p className="break-words text-caption text-muted-foreground">{accountEmail}</p> : null}<Button type="button" variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={onSignOut}>{t("signOut")}</Button></div></details>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Logo } from "@uniwork/ui/brand";
import type { ReactNode } from "react";

export interface SignedInShellProps {
  onSignOut: () => void;
  children: ReactNode;
}

/** The desktop shell chrome: wordmark, sign-out, and the current screen
 * (the deployment/workspace picker, the library, or an open document). */
export function SignedInShell({ onSignOut, children }: SignedInShellProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.login" });
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background" data-host="office-desktop" data-session-status="signed-in">
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <Logo variant="lockup" size={22} />
        <Button type="button" variant="ghost" size="sm" onClick={onSignOut}>
          {t("signOut")}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

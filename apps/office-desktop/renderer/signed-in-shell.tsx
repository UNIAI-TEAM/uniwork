import type { ReactNode } from "react";
import { DesktopTabStrip, type DesktopTabSummary } from "./tab-strip";

export interface SignedInShellProps {
  onSignOut: () => void;
  accountName?: string;
  accountEmail?: string;
  workspaceName?: string;
  onSwitchWorkspace?: () => void;
  tabs?: readonly DesktopTabSummary[];
  activeTabId?: string | null;
  onTabSelect?: (id: string | null) => void;
  onTabClose?: (id: string) => void;
  onCreate?: () => void;
  onOpenLocal?: () => void;
  createDisabled?: boolean;
  busy?: boolean;
  children: ReactNode;
}

const noop = () => undefined;

export function SignedInShell({ onSignOut, accountName, accountEmail, onSwitchWorkspace, tabs = [], activeTabId = null, onTabSelect = noop, onTabClose = noop, onCreate = noop, onOpenLocal = noop, createDisabled, busy, children }: SignedInShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-host="office-desktop" data-session-status="signed-in">
      <DesktopTabStrip tabs={tabs} activeTabId={activeTabId} onSelect={onTabSelect} onClose={onTabClose} onCreate={onCreate} onOpenLocal={onOpenLocal} createDisabled={createDisabled} busy={busy} accountName={accountName} accountEmail={accountEmail} onSwitchWorkspace={onSwitchWorkspace} onSignOut={onSignOut} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

import type { ReactNode } from "react";
import { DesktopTabStrip, type DesktopTabSummary } from "./tab-strip";

export interface DesktopShellProps {
  mode: "local" | "signed-in";
  onSignIn?: () => void;
  onSignOut?: () => void;
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

/** Window chrome shared by both modes: the title bar/tab strip and the content
 * area. Which home tab it pins (library vs local) follows `mode`. */
export function DesktopShell({ mode, onSignIn, onSignOut, accountName, accountEmail, onSwitchWorkspace, tabs = [], activeTabId = null, onTabSelect = noop, onTabClose = noop, onCreate = noop, onOpenLocal = noop, createDisabled, busy, children }: DesktopShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-host="office-desktop" data-session-status={mode === "signed-in" ? "signed-in" : "local"}>
      <DesktopTabStrip mode={mode === "local" ? "local" : "cloud"} onSignIn={onSignIn} tabs={tabs} activeTabId={activeTabId} onSelect={onTabSelect} onClose={onTabClose} onCreate={onCreate} onOpenLocal={onOpenLocal} createDisabled={createDisabled} busy={busy} accountName={accountName} accountEmail={accountEmail} onSwitchWorkspace={onSwitchWorkspace} onSignOut={onSignOut ?? noop} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
    </div>
  );
}

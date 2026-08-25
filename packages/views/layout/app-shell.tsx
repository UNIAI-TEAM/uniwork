import type { User, Workspace } from "@uniwork/core/types";
import { Sidebar } from "./sidebar";

export function AppShell({
  workspace,
  user,
  active,
  children,
}: {
  workspace: Workspace;
  user: User;
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh bg-canvas">
      <Sidebar workspace={workspace} user={user} active={active} />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}

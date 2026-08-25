"use client";

import type { ReactNode } from "react";
import { WSProvider } from "@uniwork/core/realtime";
import { SidebarInset, SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspaceProvider } from "./workspace-context";

interface DashboardLayoutProps {
  orgSlug: string;
  wsSlug: string;
  children: ReactNode;
  /** Rendered inside the content inset, above the page (dialogs, overlays). */
  extra?: ReactNode;
  loadingFallback?: ReactNode;
}

/**
 * Everything a workspace screen sits inside: the gate (auth → onboarding →
 * workspace), the resolved workspace context, the realtime socket for that
 * workspace, the sidebar, and the content inset with the navigation progress
 * bar. Web and any future host compose their route params into this and
 * nothing else.
 */
export function DashboardLayout({ orgSlug, wsSlug, children, extra, loadingFallback }: DashboardLayoutProps) {
  return (
    <DashboardGuard orgSlug={orgSlug} wsSlug={wsSlug} loadingFallback={loadingFallback}>
      {({ user, workspace }) => (
        <WorkspaceProvider workspace={workspace} user={user}>
          <WSProvider workspaceSlug={`${orgSlug}/${wsSlug}`}>
            <SidebarProvider className="h-svh bg-app-shell">
              <AppSidebar />
              <SidebarInset className="relative overflow-hidden">
                <NavigationProgress />
                {children}
                {extra}
              </SidebarInset>
            </SidebarProvider>
          </WSProvider>
        </WorkspaceProvider>
      )}
    </DashboardGuard>
  );
}

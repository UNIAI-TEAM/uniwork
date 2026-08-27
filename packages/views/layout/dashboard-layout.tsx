"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { WSProvider } from "@uniwork/core/realtime";
import { SidebarInset, SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspaceChrome } from "./workspace-top-bar";
import { WorkspaceLoader } from "./workspace-loader";
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
 * Target of the skip link below. The workspace shell is nav-heavy: without it,
 * every keyboard user pays the whole sidebar in tab stops on every screen
 * before reaching the page.
 */
const MAIN_CONTENT_ID = "main-content";

/**
 * Everything a workspace screen sits inside: the gate (auth → onboarding →
 * workspace), the resolved workspace context, the realtime socket for that
 * workspace, the sidebar, and the content inset with the navigation progress
 * bar. Web and any future host compose their route params into this and
 * nothing else.
 */
export function DashboardLayout({ orgSlug, wsSlug, children, extra, loadingFallback }: DashboardLayoutProps) {
  const { t } = useTranslation();
  return (
    <DashboardGuard orgSlug={orgSlug} wsSlug={wsSlug} loadingFallback={loadingFallback ?? <WorkspaceLoader />}>
      {({ user, workspace }) => (
        <WorkspaceProvider workspace={workspace} user={user}>
          <WSProvider workspaceSlug={`${orgSlug}/${wsSlug}`}>
            <SidebarProvider className="h-svh bg-app-shell" hasExternalTrigger>
              {/* First in the DOM so it is the first tab stop; visible only
                  while focused. */}
              <a
                href={`#${MAIN_CONTENT_ID}`}
                className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-popover focus-visible:px-3 focus-visible:py-2 focus-visible:text-body focus-visible:text-popover-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("nav.skip_to_content")}
              </a>
              <AppSidebar />
              <SidebarInset id={MAIN_CONTENT_ID} tabIndex={-1} className="relative overflow-hidden outline-hidden">
                <NavigationProgress />
                <WorkspaceChrome>{children}</WorkspaceChrome>
                {extra}
              </SidebarInset>
            </SidebarProvider>
          </WSProvider>
        </WorkspaceProvider>
      )}
    </DashboardGuard>
  );
}

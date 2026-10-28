"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PublicConfigFlagsProvider } from "@uniwork/core/feature-flags";
import { setCurrentWorkspace } from "@uniwork/core/platform";
import { WSProvider } from "@uniwork/core/realtime";
import { SidebarInset, SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { cn } from "@uniwork/ui/lib/utils";
import { AppSidebar } from "./app-sidebar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspaceChrome } from "./workspace-top-bar";
import { WorkspaceLoader } from "./workspace-loader";
import { WorkspaceProvider } from "./workspace-context";
import { EntitlementGateToastHost } from "./entitlement-gate-toast";
import { FolderAccessBatchWatchers } from "./folder-access-batch-watchers";
import { WorkspaceRealtimeSync } from "./workspace-realtime-sync";
import { WorkspaceChatPresence } from "./workspace-chat-presence";
import { WorkspaceChatAttention } from "./workspace-chat-attention";
import { WorkspaceChatToast } from "./workspace-chat-toast";
import { BrowserNotificationsPrompt } from "./browser-notifications-prompt";
import { WorkspaceRail } from "./workspace-rail";
import { ChatVoiceCallHost } from "../chat/chat-voice-call-host";

interface DashboardLayoutProps {
  orgSlug: string;
  wsSlug: string;
  children: ReactNode;
  /** Rendered inside the content inset, above the page (dialogs, overlays). */
  extra?: ReactNode;
  loadingFallback?: ReactNode;
  /** `chat-only` is the UniChat shell: a workspace rail instead of the sidebar, no top bar, no inset card. */
  variant?: "full" | "chat-only";
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
export function DashboardLayout({ orgSlug, wsSlug, children, extra, loadingFallback, variant }: DashboardLayoutProps) {
  const { t } = useTranslation();
  const chatOnly = variant === "chat-only";
  return (
    <DashboardGuard orgSlug={orgSlug} wsSlug={wsSlug} loadingFallback={loadingFallback ?? <WorkspaceLoader />}>
      {({ user, workspace }) => {
        // Render-phase, before any child store reads or writes: workspace-scoped
        // persisted state (task views, navigation, chat drafts) namespaces its
        // keys by this slug and drops writes while it is unset. It self-dedupes
        // and defers its rehydrate/notify side effects to a microtask, so
        // calling it on every render is safe.
        setCurrentWorkspace(`${orgSlug}/${wsSlug}`, workspace.id);
        return (
          <WorkspaceProvider workspace={workspace} user={user}>
            {/* Organization-scoped flag overrides only reach the screens through this answer. */}
            <PublicConfigFlagsProvider organizationId={workspace.organization_id}>
              <WSProvider workspaceSlug={`${orgSlug}/${wsSlug}`}>
                <ChatVoiceCallHost>
                  <WorkspaceRealtimeSync />
                  <EntitlementGateToastHost />
                  <FolderAccessBatchWatchers wsId={workspace.id} />
                  <WorkspaceChatPresence />
                  <WorkspaceChatAttention />
                  {/* A column: the top bar across the app, then the row of nav and content. */}
                  <SidebarProvider className="h-svh flex-col bg-app-shell" hasExternalTrigger>
                    {/* First in the DOM so it is the first tab stop; visible only
                        while focused. */}
                    <a
                      href={`#${MAIN_CONTENT_ID}`}
                      className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-popover focus-visible:px-3 focus-visible:py-2 focus-visible:text-body focus-visible:text-popover-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("nav.skip_to_content")}
                    </a>
                    <WorkspaceChrome
                      bare={chatOnly}
                      nav={chatOnly ? <WorkspaceRail /> : <AppSidebar />}
                      frame={(content) => (
                        // clip, not hidden: an sr-only or other absolute node inside a
                        // page's inner scroller overflows this positioned frame, and a
                        // hidden frame still scrolls under scrollIntoView or focus,
                        // dragging the page off screen (UNI-1995). On a desktop
                        // workspace shell the frame is the app plane: its cards draw
                        // their own surface (AskUniDock).
                        <SidebarInset
                          id={MAIN_CONTENT_ID}
                          tabIndex={-1}
                          className={cn("relative overflow-clip outline-hidden", !chatOnly && "lg:bg-transparent")}
                        >
                          <BrowserNotificationsPrompt />
                          <NavigationProgress />
                          {content}
                          <WorkspaceChatToast />
                          {extra}
                        </SidebarInset>
                      )}
                    >
                      {children}
                    </WorkspaceChrome>
                  </SidebarProvider>
                </ChatVoiceCallHost>
              </WSProvider>
            </PublicConfigFlagsProvider>
          </WorkspaceProvider>
        );
      }}
    </DashboardGuard>
  );
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { registerSessionProvider } from "@uniwork/core/auth";
import { useChatUnreadBadge } from "@uniwork/core/chat";
import { getDesktopBridge } from "@uniwork/core/platform";
import { configureRuntime, runtimeConfig } from "@uniwork/core/runtime-config";
import { useWorkspace } from "@uniwork/views/layout/workspace-context";
import { useNavigation } from "@uniwork/views/navigation";
import { parseDeepLink } from "./chat-only-navigation";

/**
 * Everything the web app does differently inside the UniChat shell lives
 * here. Importing this module (application-providers does, beside
 * runtime-config) registers the shell's session provider synchronously, before
 * CoreProvider's AuthInitializer runs, and tags the socket as a desktop client.
 * Without a bridge every export is a no-op and the cookie path stays as it is.
 */
if (typeof window !== "undefined") {
  const bridge = getDesktopBridge();
  if (bridge) {
    registerSessionProvider(bridge.session);
    configureRuntime({ clientPlatform: "desktop" });
    // The macOS shell hides its title bar; globals.css turns `data-window-drag`
    // regions into its drag handle. Fullscreen hides the traffic lights, so
    // their strip goes too: only a fullscreen window is as tall as the screen
    // (a windowed one stops at the menu bar), and no media query reports it.
    if (bridge.appInfo.os === "macos") {
      const syncWindowChrome = () => {
        document.documentElement.dataset.windowChrome = window.innerHeight >= window.screen.height ? "fullscreen" : "inset";
      };
      syncWindowChrome();
      window.addEventListener("resize", syncWindowChrome);
    }
  }
}

const noopSubscribe = () => () => {};

/** True inside the UniChat shell. The server snapshot is false so hydration never differs. */
export function useIsUniChatHost(): boolean {
  return useSyncExternalStore(noopSubscribe, () => getDesktopBridge() !== null, () => false);
}

/** Opens the room a deep link names, through the same guarded push as any in-app move. */
export function DesktopHost(): null {
  const { push } = useNavigation();
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    return bridge.onDeepLink((url) => {
      const path = parseDeepLink(url, runtimeConfig().appUrl);
      if (path) push(path);
    });
  }, [push]);
  return null;
}

/** Mirrors the chat unread badge of the current workspace onto the dock/taskbar icon. */
export function UniChatBadge(): null {
  const { workspace } = useWorkspace();
  const count = useChatUnreadBadge(workspace.id);
  useEffect(() => {
    getDesktopBridge()?.setBadgeCount(count);
  }, [count]);
  // Separate from the count effect so a change never flashes 0 between two IPC calls.
  useEffect(() => () => getDesktopBridge()?.setBadgeCount(0), []);
  return null;
}

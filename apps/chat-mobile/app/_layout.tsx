// Ported from usf apps/mobile/app/_layout.tsx without Keyboard / Lightbox /
// session-activity: the root providers, the 401 teardown, deep links and the
// notification tap, all above the Stack.
import "../global.css";

import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { configureRuntime, runtimeConfig } from "@uniwork/core/runtime-config";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, ThemeProvider, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { api } from "@/data/api";
import { isAuthCallbackUrl } from "@/data/auth/callback";
import { authConfig, session } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { queryClient } from "@/data/query-client";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { deepLinkHref, parseDeepLink, setPendingDeepLink } from "@/lib/deep-link";
import { I18nProvider } from "@/lib/i18n/provider";
import { runtimeFromExtra } from "@/lib/runtime-extra";
import { NAV_THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

// Before the first request: every data/* module reads runtimeConfig() per call.
configureRuntime(runtimeFromExtra(Constants.expoConfig?.extra));

/** A URL from the OS: the PKCE callback completes the sign-in; a chat link waits
 *  for one, or is pushed only when expo-router did not already route it
 *  (+native-intent routes Linking URLs; a notification tap is not one). */
function openUrl(url: string, navigate = false) {
  if (isAuthCallbackUrl(url, authConfig.scheme)) {
    void session.completeCallback(url);
    return;
  }
  const link = parseDeepLink(url, runtimeConfig().appUrl, authConfig.scheme);
  if (!link) return;
  if (!useAuthStore.getState().user) setPendingDeepLink(link);
  else if (navigate) router.push(deepLinkHref(link));
}

function AuthInitializer({ children }: { children: ReactNode }) {
  // 401 on several in-flight requests must tear down once, not once each.
  const signingOut = useRef(false);

  useEffect(() => {
    api.setOnUnauthorized(() => {
      if (signingOut.current) return;
      signingOut.current = true;
      void (async () => {
        // logout() clears the workspace store too.
        await useAuthStore.getState().logout();
        queryClient.clear();
        router.replace("/login");
        signingOut.current = false;
      })();
    });
    // A callback that arrives as a deep link adopts the session outside login(): load /me so index.tsx leaves /login.
    const unsubscribe = session.onChange((token) => {
      if (token) void useAuthStore.getState().adoptSession();
    });
    // The workspace first, so index.tsx sees it the moment isLoading drops.
    void useWorkspaceStore
      .getState()
      .restore()
      .then(() => useAuthStore.getState().initialize());

    void Linking.getInitialURL().then((url) => {
      if (url) openUrl(url);
    });
    const urlSub = Linking.addEventListener("url", ({ url }) => openUrl(url));
    // The server's push payload carries the web URL of the message in `data.url`.
    const pushSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url: unknown = response.notification.request.content.data?.url;
      if (typeof url === "string") openUrl(url, true);
    });
    return () => {
      unsubscribe();
      urlSub.remove();
      pushSub.remove();
    };
  }, []);

  return children;
}

export default function RootLayout() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <I18nProvider>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider value={NAV_THEME[colorScheme]}>
              <AuthInitializer>
                <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="index" />
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(app)" />
                </Stack>
                <PortalHost />
              </AuthInitializer>
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

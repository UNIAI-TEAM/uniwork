// Ported from usf apps/mobile/app/_layout.tsx without Keyboard / Lightbox /
// session-activity: the root providers, the 401 teardown, deep links and the
// notification tap, all above the Stack. UNI-2053 adds crash reporting (the
// SDK first, the boundary below), the build's identity on every request, the
// "Update required" gate above everything, and the toasts; S3 the encrypted
// device store (unsent messages, cached rooms) and the splash held until the
// first screen knows where it is going.
import "../global.css";

import { registerGlobals } from "@livekit/react-native";
import { PortalHost } from "@rn-primitives/portal";
import * as Sentry from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { configureRuntime, runtimeConfig } from "@uniwork/core/runtime-config";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, ThemeProvider, router, useNavigationContainerRef, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, type ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { UpdateGate } from "@/components/app/update-gate";
import { ErrorFallback } from "@/components/ui/error-fallback";
import { ToastHost } from "@/components/ui/toast-host";
import { api } from "@/data/api";
import { isAuthCallbackUrl } from "@/data/auth/callback";
import { authConfig, session } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { buildInfo } from "@/data/build-info";
import { queryClient } from "@/data/query-client";
import { createDevicePersister, installAccountCache } from "@/data/query-persister";
import { initSentry, sentryNavigation } from "@/data/sentry";
import { installDeviceStore, openDeviceStore } from "@/data/storage/device-store";
import { openNativeDeviceStore } from "@/data/storage/native-device-store";
import { clientHeaders } from "@/lib/build-info";
import { deepLinkHref, parseDeepLink, setPendingDeepLink } from "@/lib/deep-link";
import { I18nProvider } from "@/lib/i18n/provider";
import { appEnvironment, runtimeFromExtra, sentryDsn } from "@/lib/runtime-extra";
import { NAV_THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

const extra = Constants.expoConfig?.extra;
// Crash reporting first, so the rest of boot is covered; nothing starts without a DSN.
initSentry({ dsn: sentryDsn(extra), environment: appEnvironment(extra), info: buildInfo() });
// Before the first request: every data/* module reads runtimeConfig() per call.
configureRuntime(runtimeFromExtra(extra));
// Every REST call names the build (X-Client-Version / -OS / -Update-Id); the socket does in realtime-provider.
api.setClientIdentity(clientHeaders(buildInfo()));
// WebRTC globals for LiveKit, once, before any call (M3).
registerGlobals();
// The encrypted store the outbox and the cached rooms live in, before the session is restored.
installDeviceStore(openNativeDeviceStore);
installAccountCache({ queryClient, persister: createDevicePersister(openDeviceStore), version: buildInfo().version });
// The splash stays until the session, the workspace and the cache are read (audit P0-3): no spinner, no flash of /login.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
/** A boot that hangs (a Keychain that never answers) must not hold the splash for ever. */
const SPLASH_CAP_MS = 8_000;

/** A render crash anywhere: a retry screen instead of a white one, reported (components/ui/error-fallback.tsx). */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} boundary="root" />;
}

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
    const signOut = () => {
      if (signingOut.current) return;
      signingOut.current = true;
      void (async () => {
        // logout() clears the workspace store, the query cache and the send queue too.
        await useAuthStore.getState().logout();
        router.replace("/login");
        signingOut.current = false;
      })();
    };
    api.setOnUnauthorized(signOut);
    const unsubscribe = session.onChange((token) => {
      // A callback that arrives as a deep link adopts the session outside login(): load /me so index.tsx leaves /login.
      if (token) void useAuthStore.getState().adoptSession();
      // The server ended the session while a user is in (this device revoked elsewhere: socket 4001,
      // refresh device_revoked): out now, not at the next request. logout() clears the user first,
      // so the sign-out the app asked for never comes back here.
      else if (useAuthStore.getState().user) signOut();
    });
    // The session, the stored person, the workspace and the outbox are read together (data/auth/store.ts).
    void useAuthStore.getState().initialize();

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

/** The splash goes once the first screen knows where it is going, or after SPLASH_CAP_MS whatever happens. */
function useSplashUntilReady() {
  const isLoading = useAuthStore((s) => s.isLoading);
  useEffect(() => {
    const cap = setTimeout(() => SplashScreen.hide(), SPLASH_CAP_MS);
    return () => clearTimeout(cap);
  }, []);
  useEffect(() => {
    if (isLoading) return;
    // One frame for the redirect's screen to draw under it.
    const frame = requestAnimationFrame(() => SplashScreen.hide());
    return () => cancelAnimationFrame(frame);
  }, [isLoading]);
}

function RootLayout() {
  const { colorScheme, isDarkColorScheme } = useColorScheme();
  useSplashUntilReady();
  // Screen loads and app start as Sentry spans (no-op without a DSN).
  const navigationRef = useNavigationContainerRef();
  useEffect(() => {
    sentryNavigation.registerNavigationContainer(navigationRef);
  }, [navigationRef]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <I18nProvider>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider value={NAV_THEME[colorScheme]}>
              <StatusBar style={isDarkColorScheme ? "light" : "dark"} />
              <UpdateGate>
                <AuthInitializer>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="(auth)" />
                    <Stack.Screen name="(app)" />
                  </Stack>
                  <PortalHost />
                </AuthInitializer>
              </UpdateGate>
              <ToastHost />
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

// Sentry's root wrapper: touch breadcrumbs and the app-start span; a pass-through without a DSN.
export default Sentry.wrap(RootLayout);

// Ported from usf apps/mobile/app/_layout.tsx without Keyboard / Lightbox /
// session-activity: the root providers, the 401 teardown, deep links and the
// notification tap, all above the Stack. UNI-2053 adds crash reporting (the
// SDK first, the boundary below), the build's identity on every request, the
// "Update required" gate above everything, and the toasts; S3 the encrypted
// device store (unsent messages, cached rooms) and the splash held until the
// first screen knows where it is going; S4 the native calls (the in-call
// service, a Decline that waited, the push handler while open) and the
// localized notification channels; S5 the theme read once at boot (LiveKit's
// WebRTC globals moved to the call UI, which loads on the first call); S6 the
// app's language sent to the server; then the app lock and the app switcher cover.
import "../global.css";

import { PortalHost } from "@rn-primitives/portal";
import * as Sentry from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, ThemeProvider, router, useNavigationContainerRef, type ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadPrivacySettings, usageStatsEnabled } from "@/components/app/privacy";
import { PrivacyGuard } from "@/components/app/privacy-guard";
import { UpdateGate } from "@/components/app/update-gate";
import { ErrorFallback } from "@/components/ui/error-fallback";
import { PermissionPrimerHost } from "@/components/ui/permission-primer";
import { ToastHost } from "@/components/ui/toast-host";
import { api } from "@/data/api";
import { authConfig, session } from "@/data/auth/flow";
import { useAuthStore } from "@/data/auth/store";
import { bootRuntime } from "@/data/boot";
import { perfMark } from "@/data/logger";
import { startNativeCalls } from "@/data/calls/call-wiring";
import { startAppServices, trackFirstScreen, trackPushOpen } from "@/data/app-startup";
import { nativeCalls } from "@/data/calls/native-calls";
import { runChatNotificationAction, registerChatMessageCategory } from "@/data/chat-notification-actions";
import { ensureNotificationChannels } from "@/data/notification-channels";
import { queryClient } from "@/data/query-client";
import { createDevicePersister, installAccountCache } from "@/data/query-persister";
import { bestEffort } from "@/data/report";
import { sentryNavigation } from "@/data/sentry";
import { installDeviceStore, openDeviceStore } from "@/data/storage/device-store";
import { openNativeDeviceStore } from "@/data/storage/native-device-store";
import { incomingUrlAction, setPendingDeepLink } from "@/lib/deep-link";
import { createNotificationResponseHandler, handleLaunchResponse } from "@/lib/notification-response";
import { I18nProvider } from "@/components/app/i18n-provider";
import { NAV_THEME } from "@/components/ui/nav-theme";
import { loadThemePreference, useColorScheme } from "@/components/ui/use-color-scheme";

// Crash reporting first, so the rest of boot is covered (nothing starts without a DSN); then the
// server URLs every data/* module reads per call and the build's identity on every REST call
// (X-Client-Version / -OS / -Update-Id); the socket names it in realtime-provider.
bootRuntime();
// The saved theme, read once for the whole app (data/theme-preference.ts), not by each component that draws a colour.
void loadThemePreference();
// The app lock and screen security, read once too: the guard covers the app until they are known.
void loadPrivacySettings();
// The call's foreground service follows the call engine; Decline / Hang up taps that waited run now.
startNativeCalls();
// The encrypted store the outbox and the cached rooms live in, before the session is restored.
installDeviceStore(openNativeDeviceStore);
installAccountCache({ queryClient, persister: createDevicePersister(openDeviceStore) });
// Critical OTAs, the anonymous product counters, the kept remote config and the app's language sent to the server
// (data/app-startup.ts).
startAppServices({ queryClient, usageStatsEnabled });
// The splash stays until the session, the workspace and the cache are read (audit P0-3): no spinner, no flash of /login.
void SplashScreen.preventAutoHideAsync().catch(bestEffort("boot", "splash not held", "breadcrumb"));
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
  const action = incomingUrlAction(url, { appUrl: runtimeConfig().appUrl, scheme: authConfig.scheme, signedIn: useAuthStore.getState().user !== null, navigate });
  if (action.kind === "callback") void session.completeCallback(url);
  else if (action.kind === "keep") setPendingDeepLink(action.link);
  else if (action.kind === "open") router.push(action.href);
}

function AuthInitializer({ children }: { children: ReactNode }) {
  // 401 on several in-flight requests must tear down once, not once each.
  const signingOut = useRef(false);
  const { t, i18n } = useTranslation();

  // Android's channels (calls, missed calls, mentions, messages, the rest) in the app's language, renamed when it changes;
  // and a chat message push's Reply and Mark as read buttons, in that language too (data/chat-notification-actions.ts).
  useEffect(() => {
    void ensureNotificationChannels(t, { platform: Platform.OS, native: nativeCalls });
    void registerChatMessageCategory(t, Platform.OS);
  }, [t, i18n.language]);

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
    // The server's push payload carries the web URL of the message in `data.url`; Reply or Mark as read on a chat
    // notification acts where it was tapped and opens nothing (lib/notification-response.ts).
    const handleResponse = createNotificationResponseHandler({
      openUrl: (url) => openUrl(url, true),
      runChatAction: (action) => void runChatNotificationAction(action),
      trackPushOpen,
      clearLast: () => Notifications.clearLastNotificationResponse(),
    });
    const pushSub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    // The tap that launched a killed app, read now rather than trusted to reach a listener registered this late.
    handleLaunchResponse(handleResponse, Notifications.getLastNotificationResponse(), Platform.OS);
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
    const frame = requestAnimationFrame(() => {
      SplashScreen.hide();
      perfMark("first-screen");
      trackFirstScreen();
    });
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
      {/* The keyboard's frame-by-frame position for the composer (components/chat/composer.tsx). */}
      <KeyboardProvider>
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
              <PermissionPrimerHost />
              {/* Above everything the person could read: the app switcher cover and the app lock. */}
              <PrivacyGuard />
            </ThemeProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </I18nProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// Sentry's root wrapper: touch breadcrumbs and the app-start span; a pass-through without a DSN.
export default Sentry.wrap(RootLayout);

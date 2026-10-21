// Ported from usf apps/mobile/app/(app)/_layout.tsx: the auth gate, plus push
// registration once a user is signed in. Workspace membership is decided one
// level deeper, in [org]/[ws]/_layout — select-workspace is workspace-less.
// The call screen (M3) sits here, once, above every workspace screen: a push
// can stack a second workspace over the first, and a call outlives both.
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { CallOverlay } from "@/components/calls/call-overlay";
import { permissionGate } from "@/components/ui/permission-gate";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { setAppBadge } from "@/data/badge";
import { nativeCalls } from "@/data/calls/native-calls";
import { createLogger } from "@/data/logger";
import { ensureNotificationChannels } from "@/data/notification-channels";
import { registerPushToken } from "@/data/push";
import { unreadSummaryOptions } from "@/data/queries/chat";
import { useAccountSync } from "@/data/use-account-sync";
import { easProjectId } from "@/lib/runtime-extra";
import { appBadgeCount } from "@/lib/workspace-unread";

const log = createLogger("push");

export default function AppLayout() {
  const { i18n } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isLoading = useAuthStore((s) => s.isLoading);
  const unread = useQuery({ ...unreadSummaryOptions(), enabled: userId !== null }).data;
  const badge = userId ? appBadgeCount(unread) : 0;
  // The outbox, the queued reads and the offline copy of every workspace, from any screen of the signed-in app.
  useAccountSync(isLoading ? null : userId);

  useEffect(() => {
    if (!userId) return;
    const channels = () => ensureNotificationChannels((key) => i18n.t(key), { platform: Platform.OS, native: nativeCalls });
    // The notifications primer explains first and asks unprompted once per phone (data/permissions.ts).
    const ask = () => permissionGate.ensure("notifications", "notifications", { once: true });
    registerPushToken({ api, projectId: easProjectId(Constants.expoConfig?.extra), platform: Platform.OS, channels, callUI: nativeCalls.available, ask }).catch(
      // A simulator has no push token; the app works without one.
      (err: unknown) => log.warn("registration failed", { error: err instanceof Error ? err.name : typeof err }),
    );
  }, [userId, i18n]);

  // The app icon counts what is unread (audit P2 Calls); nothing once signed out.
  useEffect(() => {
    void setAppBadge(badge);
  }, [badge]);

  // A cold-start deep route mounts here before the session is restored.
  if (isLoading) return null;
  if (!userId) return <Redirect href="/login" />;
  return (
    <View className="flex-1">
      <Stack screenOptions={{ headerShown: false }} />
      <CallOverlay />
    </View>
  );
}

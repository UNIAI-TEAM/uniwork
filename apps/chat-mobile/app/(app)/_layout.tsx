// Ported from usf apps/mobile/app/(app)/_layout.tsx: the auth gate, plus push
// registration once a user is signed in. Workspace membership is decided one
// level deeper, in [org]/[ws]/_layout — select-workspace is workspace-less.
// The call screen (M3) sits here, once, above every workspace screen: a push
// can stack a second workspace over the first, and a call outlives both.
import Constants from "expo-constants";
import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { Platform, View } from "react-native";
import { CallOverlay } from "@/components/calls/call-overlay";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { registerPushToken } from "@/data/push";
import { easProjectId } from "@/lib/runtime-extra";

export default function AppLayout() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (!userId) return;
    registerPushToken({ api, projectId: easProjectId(Constants.expoConfig?.extra), platform: Platform.OS }).catch(
      // A simulator has no push token; the app works without one.
      (err: unknown) => console.warn("[push] registration failed", err),
    );
  }, [userId]);

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

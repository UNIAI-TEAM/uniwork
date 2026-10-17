// Ported from usf apps/mobile/app/(app)/_layout.tsx: the auth gate, plus push
// registration once a user is signed in. Workspace membership is decided one
// level deeper, in [org]/[ws]/_layout — select-workspace is workspace-less.
import Constants from "expo-constants";
import { Redirect, Stack } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth/store";
import { registerPushToken } from "@/data/push";

export default function AppLayout() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!userId) return;
    const eas: unknown = Constants.expoConfig?.extra?.eas;
    const projectId = (eas as { projectId?: unknown } | undefined)?.projectId;
    registerPushToken({ api, projectId: typeof projectId === "string" ? projectId : undefined, platform: Platform.OS }).catch(
      // A simulator has no push token; the app works without one.
      (err: unknown) => console.warn("[push] registration failed", err),
    );
  }, [userId]);

  if (!userId) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

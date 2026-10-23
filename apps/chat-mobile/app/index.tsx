// Ported from usf apps/mobile/app/index.tsx.
import { Redirect } from "expo-router";
import { useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { deepLinkHref, takePendingDeepLink, type DeepLink } from "@/lib/deep-link";

/**
 * Entry redirect, after AuthInitializer restored the workspace and the session:
 *   no user                → /login
 *   a link waited for login → that chat
 *   no workspace            → /select-workspace
 *   else                    → /{org}/{ws}/chat
 */
export default function Index() {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const current = useWorkspaceStore((s) => s.current);
  // Taken once per mount: a Redirect re-renders, and the second take would be empty.
  const pending = useRef<DeepLink | null | undefined>(undefined);
  if (!isLoading && user && pending.current === undefined) pending.current = takePendingDeepLink();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (pending.current) return <Redirect href={deepLinkHref(pending.current)} />;
  if (!current) return <Redirect href="/select-workspace" />;
  return <Redirect href={`/${current.orgSlug}/${current.wsSlug}/chat`} />;
}

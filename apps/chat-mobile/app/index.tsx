// Ported from usf apps/mobile/app/index.tsx.
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { deepLinkHref, takePendingDeepLink } from "@/lib/deep-link";

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

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  const pending = takePendingDeepLink();
  if (pending) return <Redirect href={deepLinkHref(pending)} />;
  if (!current) return <Redirect href="/select-workspace" />;
  return <Redirect href={`/${current.orgSlug}/${current.wsSlug}/chat`} />;
}

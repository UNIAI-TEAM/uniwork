// Ported from usf apps/mobile/app/index.tsx.
import { Redirect } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/data/auth/store";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import { takePendingLink } from "@/lib/deep-link";
import { signInRoutes } from "@/lib/sign-in-routes";

/**
 * Entry redirect, after AuthInitializer restored the workspace and the session:
 *   no user                → /login
 *   address not proved yet  → /verify-email (no workspace before it, as the web's /verify)
 *   a link waited for login → that chat, or that invitation's preview
 *   no workspace            → /select-workspace
 *   else                    → /{org}/{ws}/chat
 */
export default function Index() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const current = useWorkspaceStore((s) => s.current);
  // Taken once per mount: a Redirect re-renders, and the second take would be empty.
  const pending = useRef<string | null | undefined>(undefined);
  // Only the server's own null holds a person back (UserSchema reads an absent field as null too).
  const verified = user?.email_verified_at !== null;
  if (!isLoading && user && verified && pending.current === undefined) pending.current = takePendingLink();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (!verified) return <Redirect href={signInRoutes.verifyEmail} />;
  if (pending.current) return <Redirect href={pending.current} />;
  if (!current) return <Redirect href="/select-workspace" />;
  return <Redirect href={`/${current.orgSlug}/${current.wsSlug}/chat`} />;
}

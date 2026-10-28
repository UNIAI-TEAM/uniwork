// The account's own Settings, outside every workspace (lib/chat-routes.ts › accountRoutes): what a
// signed-in person always reaches from select-workspace, even with no workspace at all — the legal
// pages, how the account signs in, signing out and deleting the account (Apple 5.1.1(v), Play's
// account deletion policy: the privacy policy's "Settings → Delete account" holds in every
// signed-in state). The workspace's Settings tab carries the same sections beside the workspace's own.
import { Ionicons } from "@expo/vector-icons";
import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { ScrollView, View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { DeleteAccountSection } from "@/components/settings/delete-account";
import { LegalSection } from "@/components/settings/legal-section";
import { SignInMethodsSection } from "@/components/settings/sign-in-methods-section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { THEME } from "@/lib/theme";

export default function AccountSettings() {
  const { t } = useTranslation();
  const email = useAuthStore((s) => s.user?.email ?? "");
  const logout = useAuthStore((s) => s.logout);
  return (
    <View className="flex-1 bg-muted dark:bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <ChatHeader title={t("nav.settings")} flat />
      <ScrollView contentContainerClassName="gap-6 px-4 pb-6 pt-5">
        <Text className="px-1 text-callout text-muted-foreground">{t("mobile.account.signed_in_as", { email })}</Text>
        <SignInMethodsSection />
        <LegalSection />
        <Button
          variant="destructive"
          className="min-h-12 rounded-full bg-destructive-solid py-3 active:opacity-90 dark:bg-destructive-solid"
          testID="account-logout"
          // logout() drops this phone's push subscription first (data/auth/store.ts).
          onPress={() => void logout()}
        >
          <Ionicons name="log-out-outline" size={18} color={THEME.light.primaryForeground} />
          <Text className="text-body font-semibold">{t("auth.logout")}</Text>
        </Button>
        <DeleteAccountSection />
      </ScrollView>
    </View>
  );
}

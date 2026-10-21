// The "Update required" gate (audit R1): when the server's minimum
// (min_supported_mobile_version, data/remote-config.ts) is above the running
// version, the whole app is this one screen with a way to the store. It sits
// above the sign-in screen too: an old build must not even start a session.
// Nothing gates before the server answers or when it cannot be reached.
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { UniChatLogo } from "@/components/brand/unichat-logo";
import { Text } from "@/components/ui/text";
import { buildInfo } from "@/data/build-info";
import { useRemoteConfig } from "@/data/remote-config";
import { isUpdateRequired } from "@/lib/build-info";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

function UpdateRequired({ version, minimum, storeUrl, onCheckAgain }: { version: string; minimum: string; storeUrl: string; onCheckAgain: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-center gap-5 px-8">
        <UniChatLogo size={72} />
        <Text accessibilityRole="header" className="text-center text-2xl font-display font-extrabold tracking-tight text-foreground">
          {t("mobile.update.title")}
        </Text>
        <Text className="text-center text-[15px] leading-[22px] text-muted-foreground">{t("mobile.update.body", { version, min: minimum })}</Text>
        {storeUrl ? null : <Text className="text-center text-sm leading-5 text-muted-foreground">{t("mobile.update.no_store")}</Text>}
      </View>
      <View className="gap-3 px-6 pb-6">
        {storeUrl ? (
          <Pressable
            onPress={() => void Linking.openURL(storeUrl)}
            accessibilityRole="link"
            accessibilityLabel={t("mobile.update.open_store")}
            testID="update-open-store"
            className="h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary active:opacity-90"
          >
            <Ionicons name="arrow-down-circle-outline" size={20} color={THEME[colorScheme].primaryForeground} />
            <Text className="text-base font-semibold text-primary-foreground">{t("mobile.update.open_store")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onCheckAgain}
          accessibilityRole="button"
          testID="update-check-again"
          className="h-12 items-center justify-center rounded-full border border-border active:bg-secondary"
        >
          <Text className="text-base font-semibold text-foreground">{t("mobile.update.check_again")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

export function UpdateGate({ children }: { children: ReactNode }) {
  const { data, refetch } = useRemoteConfig();
  const { version } = buildInfo();
  if (!data || !isUpdateRequired(version, data.minSupportedVersion)) return children;
  return (
    <UpdateRequired
      version={version}
      minimum={data.minSupportedVersion}
      storeUrl={Platform.OS === "ios" ? data.storeUrl.ios : data.storeUrl.android}
      onCheckAgain={() => void refetch()}
    />
  );
}

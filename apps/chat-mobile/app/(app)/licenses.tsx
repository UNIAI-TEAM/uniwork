// Settings › Privacy & legal › Open-source licenses (components/settings/licenses-list.tsx).
import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { ChatHeader } from "@/components/chat/chat-header";
import { LicensesList } from "@/components/settings/licenses-list";

export default function LicensesScreen() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <ChatHeader title={t("mobile.licenses.title")} flat />
      <LicensesList />
    </View>
  );
}

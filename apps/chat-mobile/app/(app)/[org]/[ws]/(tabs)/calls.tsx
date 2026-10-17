// M1 frame of the calls tab; the real screen lands in M2.
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";

export default function CallsTab() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-background">
      <Header title={t("mobile.tab_calls")} />
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-sm text-muted-foreground text-center">{t("common.empty")}</Text>
      </View>
    </View>
  );
}

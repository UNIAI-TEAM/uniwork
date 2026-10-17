// M1 frame of the contacts tab; the real screen lands in M2.
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Header } from "@/components/ui/header";
import { Text } from "@/components/ui/text";

export default function ContactsTab() {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-background">
      <Header title={t("nav.people")} />
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-sm text-muted-foreground text-center">{t("common.empty")}</Text>
      </View>
    </View>
  );
}

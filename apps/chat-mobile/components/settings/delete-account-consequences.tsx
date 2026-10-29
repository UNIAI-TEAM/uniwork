// What erasing the account does, listed before the proof in Settings › Delete account (delete-account.tsx), with
// the privacy policy's deletion section one tap away (Google Play's account deletion policy asks the app to say
// what is deleted and what is kept). The lines are the web dialog's own (settings.security.delete.consequences), with
// one more for what happens on this phone; the sentence above them already says it cannot be undone.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { legalLinks, legalLocale } from "@/lib/legal-links";
import { continuousCorners } from "@/lib/radius";

const CONSEQUENCES = [
  ["person-remove-outline", "settings.security.delete.consequences.erased"],
  ["phone-portrait-outline", "mobile.account.consequence_this_phone"],
  ["chatbubbles-outline", "settings.security.delete.consequences.kept"],
  ["business-outline", "settings.security.delete.consequences.owner"],
] as const;

export function DeleteAccountConsequences({
  appUrl,
  iconColor,
  onOpenPage,
}: {
  /** The web app's origin the policy is read from. */
  appUrl: string;
  iconColor: string;
  onOpenPage: (url: string) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <View className="gap-2.5 rounded-xl bg-muted p-3.5" style={continuousCorners}>
      <Text accessibilityRole="header" className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        {t("mobile.account.what_happens")}
      </Text>
      {CONSEQUENCES.map(([icon, key]) => (
        <View key={key} className="flex-row items-start gap-2.5">
          <Ionicons name={icon} size={18} color={iconColor} style={{ marginTop: 2 }} />
          <Text className="flex-1 text-subhead leading-[21px] text-foreground">{t(key)}</Text>
        </View>
      ))}
      <Pressable
        accessibilityRole="link"
        onPress={() => onOpenPage(legalLinks(appUrl, legalLocale(i18n.language), "").deleteAccount)}
        className="min-h-11 justify-center self-start"
      >
        <Text className="text-subhead font-semibold text-primary">{t("mobile.account.policy_link")}</Text>
      </Pressable>
    </View>
  );
}

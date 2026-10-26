// What erasing the account does, listed before the proof in Settings › Delete account (delete-account.tsx), with
// the privacy policy's deletion section one tap away (Google Play's account deletion policy asks the app to say
// what is deleted and what is kept). The web's dialog says it in one paragraph; this list is the phone's own.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { legalLinks, legalLocale } from "@/lib/legal-links";
import { continuousCorners } from "@/lib/radius";

const CONSEQUENCES = [
  ["person-remove-outline", "mobile.account.consequence_identity"],
  ["chatbubbles-outline", "mobile.account.consequence_content"],
  ["phone-portrait-outline", "mobile.account.consequence_devices"],
  ["alert-circle-outline", "mobile.account.consequence_final"],
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

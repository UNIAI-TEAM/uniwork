// The line under the sign-in button: signing in is agreeing to the terms of use, which forbid
// objectionable content and abusive users (Apple 1.2, Google Play's UGC policy), and the privacy
// policy is one tap away. The web's sign-in and sign-up pages say the same (packages/views/auth/
// auth-legal-note.tsx). Each page is its own link with a full tap target, rather than words inside
// the sentence: a nested Text link is neither a 44 pt target nor its own element for TalkBack.
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { legalLinks, legalLocale } from "@/lib/legal-links";
import { useOpenWebPage } from "./use-open-web-page";

export function SignInLegalNote() {
  const { t, i18n } = useTranslation();
  const openWebPage = useOpenWebPage();
  const links = legalLinks(runtimeConfig().appUrl, legalLocale(i18n.language), "");
  const link = (label: string, url: string, testID: string) => (
    <Pressable accessibilityRole="link" testID={testID} onPress={() => openWebPage(url)} className="min-h-11 justify-center px-1.5 active:opacity-70">
      <Text className="text-footnote font-semibold text-primary">{label}</Text>
    </Pressable>
  );
  return (
    <View className="items-center">
      <Text className="text-center text-footnote text-muted-foreground">
        {`${t("mobile.legal.agree_prefix")} ${t("mobile.legal.terms")} ${t("mobile.legal.agree_and")} ${t("mobile.legal.privacy")}.`}
      </Text>
      <View className="flex-row flex-wrap items-center justify-center">
        {link(t("mobile.legal.terms"), links.terms, "login-terms")}
        <Text className="text-footnote text-muted-foreground" accessibilityElementsHidden importantForAccessibility="no">
          {"\u00B7"}
        </Text>
        {link(t("mobile.legal.privacy"), links.privacy, "login-privacy")}
      </View>
    </View>
  );
}

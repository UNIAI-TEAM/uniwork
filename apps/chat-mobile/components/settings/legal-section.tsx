// Settings › Privacy & legal (Apple 5.1.1, Google Play's privacy policy
// requirement): the privacy policy and the terms of use in the
// in-app browser, support by email (the address is copied when the phone has
// no mail app), the open-source licenses, and the answer to the AI processing
// notice with a way to change it. Where each row leads: lib/legal-links.ts.
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiConsentSheet, useAiConsent } from "@/components/chat/ai-consent-notice";
import { buildInfo } from "@/data/build-info";
import { toast } from "@/data/stores/toast-store";
import { accountRoutes } from "@/lib/chat-routes";
import { legalLinks, legalLocale, SUPPORT_EMAIL } from "@/lib/legal-links";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";
import { useOpenWebPage } from "./use-open-web-page";

export function LegalSection() {
  const { t, i18n } = useTranslation();
  const consented = useAiConsent();
  const [aiOpen, setAiOpen] = useState(false);
  const openWebPage = useOpenWebPage();
  const links = legalLinks(runtimeConfig().appUrl, legalLocale(i18n.language), t("mobile.legal.support_subject", { version: buildInfo().version }));

  const contactSupport = async () => {
    try {
      await Linking.openURL(links.support);
    } catch {
      await Clipboard.setStringAsync(SUPPORT_EMAIL);
      toast.success(t("mobile.legal.support_copied", { email: SUPPORT_EMAIL }));
    }
  };

  return (
    <SettingsSection title={t("mobile.legal.title")}>
      <SettingsRow first icon="shield-checkmark-outline" label={t("mobile.legal.privacy")} external testID="legal-privacy" onPress={() => openWebPage(links.privacy)} />
      <SettingsRow icon="document-text-outline" label={t("mobile.legal.terms")} external testID="legal-terms" onPress={() => openWebPage(links.terms)} />
      <SettingsRow
        icon="sparkles-outline"
        label={t("mobile.legal.ai")}
        value={consented ? t("mobile.legal.ai_on") : t("mobile.legal.ai_off")}
        testID="legal-ai"
        onPress={() => setAiOpen(true)}
      />
      <SettingsRow icon="mail-outline" label={t("mobile.legal.support")} external testID="legal-support" onPress={() => void contactSupport()} />
      <SettingsRow icon="code-slash-outline" label={t("mobile.legal.licenses")} testID="legal-licenses" onPress={() => router.push(accountRoutes.licenses)} />
      <AiConsentSheet visible={aiOpen} onClose={() => setAiOpen(false)} />
    </SettingsSection>
  );
}

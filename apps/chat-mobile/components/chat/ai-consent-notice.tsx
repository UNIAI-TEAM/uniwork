// The AI processing notice (Apple 5.1.2(i)): before UniChat sends anything to
// the AI provider for the first time, it names the provider and what is sent,
// and asks. The catch-up sheet shows it in place of the summary until the
// person agrees; Settings › Privacy & legal shows it with the answer on file
// and a way to withdraw (AiConsentSheet). The answer lives on the server
// (data/ai-consent.ts, through useAnswerAiConsent), so a second phone does not
// ask again.
import { Ionicons } from "@expo/vector-icons";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, AccessibilityInfo, Pressable, ScrollView, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { useOpenWebPage } from "@/components/settings/use-open-web-page";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { useAuthStore } from "@/data/auth/store";
import { useAnswerAiConsent } from "@/data/mutations/account";
import { toast } from "@/data/stores/toast-store";
import { AI_PROVIDER, hasAiConsent } from "@/lib/ai-consent";
import { legalLinks, legalLocale } from "@/lib/legal-links";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

/** Whether the signed-in person agreed to the notice this build shows. */
export function useAiConsent(): boolean {
  return useAuthStore((s) => hasAiConsent(s.user));
}

function Point({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-start gap-2.5">
      <Ionicons name={icon} size={18} color={THEME[colorScheme].primary} style={{ marginTop: 2 }} />
      <Text className="flex-1 text-subhead leading-[21px] text-foreground">{text}</Text>
    </View>
  );
}

/** What is sent, to whom, and the person's rights; the buttons are the caller's. */
export function AiConsentText() {
  const { t, i18n } = useTranslation();
  const openWebPage = useOpenWebPage();
  const privacy = legalLinks(runtimeConfig().appUrl, legalLocale(i18n.language), "").privacy;
  return (
    <View className="gap-3.5">
      <View className="flex-row items-center gap-3">
        <TintTile tint="blue" icon="sparkles" size={40} iconSize={20} />
        <Text accessibilityRole="header" className="flex-1 text-title3 font-display font-bold text-foreground">
          {t("mobile.ai_consent.title")}
        </Text>
      </View>
      <Text className="text-body leading-[22px] text-foreground">{t("mobile.ai_consent.body", { provider: AI_PROVIDER })}</Text>
      <View className="gap-2.5">
        <Point icon="hand-left-outline" text={t("mobile.ai_consent.point_on_request")} />
        <Point icon="shield-checkmark-outline" text={t("mobile.ai_consent.point_no_training")} />
        <Point icon="settings-outline" text={t("mobile.ai_consent.point_withdraw")} />
      </View>
      <Pressable accessibilityRole="link" onPress={() => openWebPage(privacy)} className="min-h-11 justify-center self-start">
        <Text className="text-subhead font-semibold text-primary">{t("mobile.ai_consent.learn_more")}</Text>
      </Pressable>
    </View>
  );
}

/** Agree / Not now under the notice. A refusal of the save stays on the notice, said inline (a toast would sit under a Modal). */
export function AiConsentActions({ onDecline, onAgreed }: { onDecline: () => void; onAgreed?: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const answer = useAnswerAiConsent();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const agree = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await answer.mutateAsync(true);
      onAgreed?.();
    } catch {
      setFailed(true);
      AccessibilityInfo.announceForAccessibility(t("mobile.ai_consent.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View className="gap-2.5">
      {failed ? (
        <Text accessibilityRole="alert" className="text-subhead text-destructive">
          {t("mobile.ai_consent.failed")}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        testID="ai-consent-agree"
        onPress={() => void agree()}
        className={cn("min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3", busy ? "opacity-70" : "active:opacity-80")}
      >
        {busy ? <ActivityIndicator accessibilityLabel={t("common.loading")} color={THEME[colorScheme].primaryForeground} /> : null}
        <Text className="text-body font-semibold text-primary-foreground">{t("mobile.ai_consent.agree")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onDecline} className="min-h-12 items-center justify-center rounded-full bg-muted px-4 py-3 active:opacity-70">
        <Text className="text-body font-semibold text-foreground">{t("mobile.ai_consent.decline")}</Text>
      </Pressable>
    </View>
  );
}

/** Settings › Privacy & legal › AI processing: the notice, the answer on file, agree or withdraw. */
export function AiConsentSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const granted = useAiConsent();
  const agreedAt = useAuthStore((s) => s.user?.ai_consent_at ?? null);
  const answer = useAnswerAiConsent();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await answer.mutateAsync(false);
      onClose();
      toast.success(t("mobile.ai_consent.withdrawn"));
    } catch {
      setFailed(true);
      AccessibilityInfo.announceForAccessibility(t("mobile.ai_consent.failed"));
    } finally {
      setBusy(false);
    }
  };
  const date = agreedAt ? new Date(agreedAt) : null;
  return (
    <BottomSheet visible={visible} onClose={onClose} dragFrom="handle" sizeClassName="max-h-[90%]">
      <ScrollView contentContainerClassName="gap-5 px-5 pb-4">
        <AiConsentText />
        {granted ? (
          <View className="gap-2.5">
            {date && !Number.isNaN(date.getTime()) ? (
              <Text className="text-subhead text-muted-foreground">
                {t("mobile.ai_consent.agreed_on", { date: date.toLocaleDateString(i18n.language === "en" ? "en-GB" : "vi-VN") })}
              </Text>
            ) : null}
            {failed ? (
              <Text accessibilityRole="alert" className="text-subhead text-destructive">
                {t("mobile.ai_consent.failed")}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              onPress={() => void withdraw()}
              className={cn("min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-muted py-3", busy ? "opacity-70" : "active:opacity-80")}
            >
              {busy ? <ActivityIndicator accessibilityLabel={t("common.loading")} /> : null}
              <Text className="text-body font-semibold text-destructive">{t("mobile.ai_consent.withdraw")}</Text>
            </Pressable>
          </View>
        ) : (
          <AiConsentActions onDecline={onClose} onAgreed={onClose} />
        )}
      </ScrollView>
    </BottomSheet>
  );
}

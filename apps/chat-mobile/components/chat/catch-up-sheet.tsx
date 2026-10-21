// "Bắt kịp nhanh" on the phone (MobileList board): the banner above the list
// opens this sheet, which asks UNI for a brief of the conversation holding the
// most unread messages (POST …/ai/chat/catch-up, as the web's
// chat-catch-up-sheet.tsx does) and offers to open it. Nothing is sent
// before the person agreed to the AI processing notice (Apple 5.1.2(i)):
// until then the sheet shows the notice instead (ai-consent-notice.tsx).
import { Ionicons } from "@expo/vector-icons";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { CallAwareModal } from "@/components/ui/call-aware-modal";
import { SafeAreaView } from "react-native-safe-area-context";
import { SheetGrabber } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { useCatchUp } from "@/data/mutations/rooms";
import { AiConsentActions, AiConsentText, useAiConsent } from "./ai-consent-notice";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

export interface CatchUpTarget {
  roomId: string;
  title: string;
  unread: number;
}

/** The banner above the list: how much is unread and that UNI can sum it up. */
export function CatchUpBanner({ total, rooms, onPress }: { total: number; rooms: number; onPress: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("chat.sidebar_catch_up_title")}, ${t("chat.sidebar_catch_up_body", { count: total, rooms })}`}
      onPress={onPress}
      className="mx-4 mb-1.5 mt-1 flex-row items-center gap-3 rounded-[14px] border border-primary/25 bg-tint-blue px-3 py-2.5 active:opacity-80"
      style={continuousCorners}
    >
      <TintTile tint="blue" icon="sparkles" size={34} iconSize={17} />
      <View className="flex-1">
        <Text className="text-callout font-display font-bold text-foreground">{t("chat.sidebar_catch_up_title")}</Text>
        <Text className="text-footnote text-muted-foreground" numberOfLines={1}>
          {t("chat.mobile.catch_up_banner", { count: total })}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={THEME[colorScheme].mutedForeground} />
    </Pressable>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      <Text className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{label}</Text>
      {children}
    </View>
  );
}

export function CatchUpSheet({ wsId, target, onClose, onOpenRoom }: { wsId: string; target: CatchUpTarget | null; onClose: () => void; onOpenRoom: (roomId: string) => void }) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const brief = useCatchUp(wsId);
  const { mutate, reset } = brief;
  const roomId = target?.roomId ?? null;
  const consented = useAiConsent();
  const locale = i18n.language;
  useEffect(() => {
    if (roomId && consented) mutate({ roomId, locale });
    else reset();
  }, [roomId, consented, locale, mutate, reset]);
  const result = brief.data ?? null;
  const highlights = result ? (result.highlight_items.length > 0 ? result.highlight_items.map((item) => item.text) : result.highlights) : [];
  const empty = result !== null && result.message_count === 0 && highlights.length === 0 && result.action_items.length === 0;
  const failed = brief.isError || (brief.isSuccess && result === null);

  return (
    <CallAwareModal visible={target !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="max-h-[85%] rounded-t-[24px] bg-card" style={continuousCorners} accessibilityViewIsModal>
        <SheetGrabber />
        <View className="flex-row items-center gap-3 px-5 pb-3">
          <TintTile tint="blue" icon="sparkles" size={40} iconSize={20} />
          <View className="flex-1">
            <Text accessibilityRole="header" className="text-title3 font-display font-bold text-foreground" numberOfLines={1}>
              {t("chat.sidebar_catch_up_title")}
            </Text>
            {target ? (
              <Text className="text-footnote text-muted-foreground" numberOfLines={1}>
                {t("chat.unread_count_chip", { count: target.unread })} · {target.title}
              </Text>
            ) : null}
          </View>
        </View>
        <ScrollView contentContainerClassName="gap-4 px-5 pb-4">
          {!consented ? (
            <>
              <AiConsentText />
              <AiConsentActions onDecline={onClose} />
            </>
          ) : failed ? (
            <Text accessibilityRole="alert" className="text-body text-destructive">
              {t("chat.ai.catch_up_failed")}
            </Text>
          ) : !result ? (
            <View accessibilityRole="progressbar" className="flex-row items-center gap-2 py-2">
              <ActivityIndicator />
              <Text className="text-body text-foreground">{t("chat.ai.catch_up_loading")}</Text>
            </View>
          ) : empty ? (
            <Text className="text-body text-muted-foreground">{t("chat.ai.catch_up_empty")}</Text>
          ) : (
            <>
              {result.summary ? (
                <Section label={t("chat.mobile.catch_up_summary")}>
                  <Text className="text-body leading-6 text-foreground">{result.summary}</Text>
                </Section>
              ) : null}
              {highlights.length > 0 ? (
                <Section label={t("chat.mobile.catch_up_highlights")}>
                  {highlights.map((line, index) => (
                    <View key={index} className="flex-row gap-2">
                      <Text className="text-body text-muted-foreground">•</Text>
                      <Text className="flex-1 text-body leading-6 text-foreground">{line}</Text>
                    </View>
                  ))}
                </Section>
              ) : null}
              {result.action_items.length > 0 ? (
                <Section label={t("chat.mobile.catch_up_actions")}>
                  {result.action_items.map((item, index) => (
                    <View key={index} className="flex-row items-start gap-2 rounded-xl border border-border px-3 py-2.5">
                      <Ionicons name="checkmark-circle-outline" size={18} color={THEME[colorScheme].primary} />
                      <View className="flex-1">
                        <Text className="text-subhead text-foreground">{item.title}</Text>
                        {item.owner || item.due ? <Text className="text-footnote text-muted-foreground">{[item.owner, item.due].filter(Boolean).join(" · ")}</Text> : null}
                      </View>
                    </View>
                  ))}
                </Section>
              ) : null}
            </>
          )}
        </ScrollView>
        {target && consented ? (
          <View className="px-4 pb-2 pt-1">
            <Pressable accessibilityRole="button" className="min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 active:opacity-80" onPress={() => onOpenRoom(target.roomId)}>
              <Text className="text-body font-semibold text-primary-foreground">{t("chat.mobile.catch_up_open", { name: target.title })}</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
    </CallAwareModal>
  );
}

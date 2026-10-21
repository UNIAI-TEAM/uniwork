// Reporting a message or a person (Apple 1.2, Google Play's user-generated
// content policy): from a message's long-press menu, a DM's details or a
// group member's menu. One reason from the server's closed set, optional
// words, and — when there is a person to block — "also block" in the same
// step, as the big messengers offer. The organization's admins read reports
// in the audit trail (chat.report.created). A refusal stays in the sheet,
// said under the button (a toast would sit under the Modal).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useBlockUser, useReport } from "@/data/mutations/safety";
import { toast } from "@/data/stores/toast-store";
import { continuousCorners } from "@/lib/radius";
import { REPORT_DETAILS_MAX, REPORT_REASONS, reportBody, type ReportReason, type ReportTarget } from "@/lib/report";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

interface Props {
  wsId: string;
  target: ReportTarget | null;
  /** The person "also block" acts on: a message's sender or the person reported; absent hides the switch. */
  blockUserId?: string;
  onClose: () => void;
  /** After the report (and the block) went through. */
  onReported?: (blocked: boolean) => void;
}

export function ReportSheet({ wsId, target, blockUserId, onClose, onReported }: Props) {
  const { t } = useTranslation();
  const report = useReport(wsId).mutateAsync;
  const setBlocked = useBlockUser(wsId).mutateAsync;
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = target?.name ?? "";

  const reset = () => {
    setReason(null);
    setDetails("");
    setAlsoBlock(false);
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };
  const say = (message: string) => {
    setError(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const submit = async () => {
    if (busy || !target) return;
    if (!reason) {
      say(t("mobile.report.pick_reason"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await report(reportBody(target, reason, details));
    } catch {
      setBusy(false);
      say(t("mobile.report.failed"));
      return;
    }
    // The report stands even if the block fails; the person can block from the details later.
    const blocked = alsoBlock && blockUserId ? await setBlocked({ userId: blockUserId, blocked: true }).then(() => true, () => false) : false;
    setBusy(false);
    reset();
    onClose();
    toast.success(blocked ? t("mobile.report.sent_blocked", { name }) : t("mobile.report.sent"));
    onReported?.(blocked);
  };

  return (
    <BottomSheet visible={target !== null} onClose={close} dragFrom="handle" avoidKeyboard keyboardClassName="max-h-[92%]">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-4">
        <View className="gap-1.5">
          <Text accessibilityRole="header" className="text-title2 font-display font-bold text-foreground">
            {target?.kind === "message" ? t("mobile.report.title_message") : t("mobile.report.title_user", { name })}
          </Text>
          <Text className="text-subhead leading-[21px] text-muted-foreground">{t("mobile.report.body", { name })}</Text>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.report.reason_label")} className="overflow-hidden rounded-xl border border-border" style={continuousCorners}>
          {REPORT_REASONS.map((value, index) => {
            const selected = value === reason;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                testID={`report-reason-${value}`}
                onPress={() => {
                  setReason(value);
                  setError(null);
                }}
                className={cn("min-h-12 flex-row items-center gap-3 px-3.5 active:bg-secondary", index > 0 && "border-t-hairline border-border")}
              >
                <View className={cn("h-5 w-5 items-center justify-center rounded-full border-2", selected ? "border-primary" : "border-muted-foreground/50")}>
                  {selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                </View>
                <Text className="flex-1 text-body text-foreground">{t(`mobile.report.reason_${value}`)}</Text>
              </Pressable>
            );
          })}
        </View>
        <View className="gap-1.5">
          <Text className="text-subhead font-semibold text-foreground">{t("mobile.report.details_label")}</Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            maxLength={REPORT_DETAILS_MAX}
            multiline
            textAlignVertical="top"
            placeholder={t("mobile.report.details_placeholder")}
            placeholderTextColor={theme.mutedForeground}
            accessibilityLabel={t("mobile.report.details_label")}
            editable={!busy}
            className="min-h-[88px] rounded-xl border border-border bg-muted px-3.5 py-2.5 text-body text-foreground"
          />
        </View>
        {blockUserId ? (
          <View className="min-h-12 flex-row items-center gap-3">
            <Text className="flex-1 text-body text-foreground">{t("mobile.report.also_block", { name })}</Text>
            <Switch value={alsoBlock} onValueChange={setAlsoBlock} accessibilityLabel={t("mobile.report.also_block", { name })} trackColor={{ true: theme.destructive }} />
          </View>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-subhead text-destructive">
            {error}
          </Text>
        ) : null}
        <View className="gap-2.5">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy || !reason }}
            testID="report-submit"
            onPress={() => void submit()}
            className={cn("min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-destructive-solid py-3", busy || !reason ? "opacity-60" : "active:opacity-90")}
          >
            {busy ? <ActivityIndicator accessibilityLabel={t("common.loading")} color={THEME.light.primaryForeground} /> : null}
            <Text className="text-body font-semibold text-on-solid">{t("mobile.report.submit")}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={close} className="min-h-12 items-center justify-center rounded-full bg-muted px-4 py-3 active:opacity-70">
            <Text className="text-body font-semibold text-foreground">{t("common.cancel")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

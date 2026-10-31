// Creating a reminder, the phone's chat-create-reminder-dialog.tsx: what to be
// reminded of, when (the web's quick presets; a custom moment stays on the
// web, the phone has no date picker yet), and how often. The time is worked
// out at the send, as on the web.
import { Ionicons } from "@expo/vector-icons";
import {
  canSubmitReminder,
  isSameCalendarDay,
  isTomorrow,
  remindAtFromPreset,
  REMINDER_BODY_MAX_LENGTH,
  REMINDER_REPEAT_OPTIONS,
  type ReminderRepeat,
} from "@uniwork/core/chat/reminder-utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { dateTimeFormat } from "@/lib/locale-format";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { FORM_FIELD, FormSheetFooter, FormSheetHeader, FormSheetLabel } from "./form-sheet";

const PRESETS = ["15m", "30m", "tomorrow_9"] as const;
type Preset = (typeof PRESETS)[number];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn(
        "min-h-11 flex-row items-center gap-1.5 rounded-full px-3.5",
        selected ? "border border-primary/25 bg-primary/10" : "border border-transparent bg-muted",
      )}
    >
      {selected ? <Ionicons name="checkmark" size={16} color={THEME[colorScheme].primary} /> : null}
      <Text className={cn("text-body font-semibold", selected ? "text-primary" : "text-foreground")}>{label}</Text>
    </Pressable>
  );
}

function scheduleLine(preset: Preset, locale: string, t: (key: string, values?: Record<string, string>) => string): string {
  const remindAt = remindAtFromPreset(preset);
  if (!remindAt) return "";
  const now = new Date();
  const time = dateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(remindAt);
  if (isSameCalendarDay(now, remindAt)) return t("chat.reminder_schedule_today", { time });
  if (isTomorrow(now, remindAt)) return t("chat.reminder_schedule_tomorrow", { time });
  const date = dateTimeFormat(locale, { day: "numeric", month: "short" }).format(remindAt);
  return t("chat.reminder_schedule_on", { date, time });
}

export function ReminderSheet({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (input: { body: string; remindAt: Date; repeat: ReminderRepeat }) => void;
}) {
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [body, setBody] = useState("");
  const [preset, setPreset] = useState<Preset>("30m");
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  const ready = canSubmitReminder(body, remindAtFromPreset(preset));
  const when = scheduleLine(preset, i18n.language, t);

  const create = () => {
    const remindAt = remindAtFromPreset(preset);
    if (!remindAt || !canSubmitReminder(body, remindAt)) return;
    onCreate({ body, remindAt, repeat });
    setBody("");
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0" testID="reminder-sheet">
      <FormSheetHeader title={t("chat.reminder_create_title")} description={t("chat.reminder_create_description")} onClose={onClose} />
      <View className="px-4">
        <FormSheetLabel label={t("chat.reminder_body_label")} count={body.length} max={REMINDER_BODY_MAX_LENGTH} />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={t("chat.reminder_body_placeholder")}
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          accessibilityLabel={t("chat.reminder_body_label")}
          maxLength={REMINDER_BODY_MAX_LENGTH}
          multiline
          textAlignVertical="top"
          className={`${FORM_FIELD} min-h-24 py-2.5`}
        />
        <Text className="mb-2 mt-4 text-footnote font-semibold text-foreground">{t("chat.reminder_quick_time_label")}</Text>
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {PRESETS.map((value) => (
            <Chip key={value} label={t(`chat.reminder_preset_${value}`)} selected={preset === value} onPress={() => setPreset(value)} />
          ))}
        </View>
        {when ? (
          <View className="mt-3 min-h-11 flex-row items-center gap-2.5 rounded-lg bg-tint-teal px-3.5 py-2.5">
            <Ionicons name="alarm-outline" size={16} color={THEME[colorScheme].tintTealForeground} />
            <Text className="min-w-0 flex-1 text-body text-foreground">
              {t("chat.reminder_scheduled_label")} <Text className="font-semibold text-foreground">{when}</Text>
            </Text>
          </View>
        ) : null}
        <Text className="mb-2 mt-4 text-footnote font-semibold text-foreground">{t("chat.reminder_repeat_label")}</Text>
        <View className="mb-1 flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {REMINDER_REPEAT_OPTIONS.map((value) => (
            <Chip key={value} label={t(`chat.reminder_repeat_${value}`)} selected={repeat === value} onPress={() => setRepeat(value)} />
          ))}
        </View>
      </View>
      <FormSheetFooter
        hint={ready ? null : t("chat.reminder_submit_hint_body")}
        label={t("chat.reminder_create_submit")}
        disabled={!ready}
        onPress={create}
        testID="reminder-create"
      />
    </BottomSheet>
  );
}

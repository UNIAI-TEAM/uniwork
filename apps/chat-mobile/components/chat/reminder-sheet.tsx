// Creating a reminder, the phone's chat-create-reminder-dialog.tsx: what
// to be reminded of, when (the web's quick presets; picking any other moment
// stays on the web, the phone has no date picker yet), and how often. The time
// is worked out at the send, as on the web: "in 15 minutes" means from then.
// The canvas look (MobSheets, "Tạo nhắc hẹn"): a teal tile by the title, a
// filled field, chips washed in brand when picked, a round primary button.
import { Ionicons } from "@expo/vector-icons";
import { canSubmitReminder, remindAtFromPreset, REMINDER_REPEAT_OPTIONS, type ReminderRepeat } from "@uniwork/core/chat/reminder-utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

const PRESETS = ["15m", "30m", "tomorrow_9"] as const;
type Preset = (typeof PRESETS)[number];

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={cn("min-h-11 justify-center rounded-full border px-3.5 py-2", selected ? "border-primary bg-primary/10" : "border-border bg-card")}
    >
      <Text className={cn("text-callout", selected ? "font-semibold text-primary" : "font-medium text-foreground")}>{label}</Text>
    </Pressable>
  );
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
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [body, setBody] = useState("");
  const [preset, setPreset] = useState<Preset>("30m");
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  const ready = canSubmitReminder(body, remindAtFromPreset(preset));

  const create = () => {
    const remindAt = remindAtFromPreset(preset);
    if (!remindAt || !canSubmitReminder(body, remindAt)) return;
    onCreate({ body, remindAt, repeat });
    setBody("");
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4" testID="reminder-sheet">
      <View className="mb-3 flex-row items-center gap-3">
        <TintTile tint="teal" icon="alarm-outline" size={36} iconSize={19} className="rounded-control" />
        <Text className="flex-1 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
          {t("chat.reminder_create_title")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          className="h-11 w-11 items-center justify-center rounded-full bg-muted active:opacity-70"
        >
          <Ionicons name="close" size={20} color={THEME[colorScheme].mutedForeground} />
        </Pressable>
      </View>
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder={t("chat.reminder_body_placeholder")}
        placeholderTextColor={THEME[colorScheme].mutedForeground}
        accessibilityLabel={t("chat.reminder_body_label")}
        multiline
        textAlignVertical="top"
        className="min-h-[88px] rounded-xl border border-border bg-muted px-3.5 py-2.5 text-body text-foreground"
      />
      <Text className="mb-2 mt-4 text-footnote font-semibold text-muted-foreground">{t("chat.reminder_quick_time_label")}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {PRESETS.map((value) => (
          <Chip key={value} label={t(`chat.reminder_preset_${value}`)} selected={preset === value} onPress={() => setPreset(value)} />
        ))}
      </View>
      <Text className="mb-2 mt-4 text-footnote font-semibold text-muted-foreground">{t("chat.reminder_repeat_label")}</Text>
      <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
        {REMINDER_REPEAT_OPTIONS.map((value) => (
          <Chip key={value} label={t(`chat.reminder_repeat_${value}`)} selected={repeat === value} onPress={() => setRepeat(value)} />
        ))}
      </View>
      <Button
        disabled={!ready}
        accessibilityState={{ disabled: !ready }}
        onPress={create}
        className="mb-3 mt-5 min-h-12 rounded-full py-3"
        testID="reminder-create"
      >
        <Text className="text-body font-semibold">{t("chat.reminder_create_submit")}</Text>
      </Button>
    </BottomSheet>
  );
}

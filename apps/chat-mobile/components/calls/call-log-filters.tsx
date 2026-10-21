// The calls tab's filter chips (MobCalls board): all, or the missed calls with
// how many of them are loaded so far. Moved out of the route file, which only composes.
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Text } from "@/components/ui/text";
import type { CallLogFilter } from "@/lib/call-log-display";
import { BADGE_MAX_FONT_SCALE } from "@/lib/type-scale";
import { cn } from "@/lib/utils";

// shortcut: "missed" reuses the call-log label (en "Missed voice call"); mobile.calls.filter_missed is requested.
const FILTERS: { value: CallLogFilter; label: string }[] = [
  { value: "all", label: "chat.filter_all" },
  { value: "missed", label: "mobile.calls.filter_missed" },
];

export function CallLogFilters({ value, onChange, missedCount }: { value: CallLogFilter; onChange: (filter: CallLogFilter) => void; missedCount: number }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row gap-2 pb-1 pt-3">
      {FILTERS.map((option) => {
        const selected = value === option.value;
        const counted = option.value === "missed" && missedCount > 0;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityLabel={counted ? `${t(option.label)}, ${missedCount}` : t(option.label)}
            accessibilityState={{ selected }}
            hitSlop={{ top: 5, bottom: 5 }}
            className={cn("min-h-[34px] flex-row items-center gap-1.5 rounded-full px-3.5 py-1", selected ? "bg-primary" : "bg-muted active:bg-secondary")}
          >
            <Text className={cn("text-callout font-semibold", selected ? "text-primary-foreground" : "text-foreground")}>{t(option.label)}</Text>
            {counted ? (
              <View className={cn("min-h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px]", selected ? "bg-primary-foreground" : "bg-destructive-solid")}>
                <Text className={cn("text-meta font-semibold", selected ? "text-primary" : "text-on-solid")} maxFontSizeMultiplier={BADGE_MAX_FONT_SCALE}>
                  {missedCount > 99 ? "99+" : String(missedCount)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

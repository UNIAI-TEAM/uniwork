// A titled segmented control of the settings tab (theme, language): one tap
// picks a segment. Moved out of the route file, which only composes.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** One segment: the i18n key of its label, and an icon above it when it has one. */
export type Option<T> = { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap };

/** A titled segmented control: one tap picks a segment, as the radio rows it replaces did. */
export function OptionGroup<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="px-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={title} className="flex-row gap-1.5 rounded-xl bg-card p-1.5" style={continuousCorners}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              className={cn(
                "flex-1 items-center justify-center gap-1.5 rounded-lg",
                option.icon ? "min-h-[68px] py-2" : "min-h-11 py-2",
                selected ? "bg-primary" : "bg-muted active:bg-secondary",
              )}
            >
              {option.icon ? (
                <Ionicons name={option.icon} size={20} color={selected ? THEME[colorScheme].primaryForeground : THEME[colorScheme].foreground} />
              ) : null}
              <Text
                numberOfLines={1}
                className={cn(
                  "font-semibold",
                  option.icon ? "text-footnote" : "text-subhead",
                  selected ? "text-primary-foreground" : "text-foreground",
                )}
              >
                {t(option.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

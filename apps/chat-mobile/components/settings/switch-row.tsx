// One switch row of a Settings card: an icon tile, the label with a hint
// under it, and the switch, which tells assistive technology when it is
// disabled (React Native's Switch does not). Rows after the first sit under a
// hairline, as SettingsRow's do.
import { Switch, View } from "react-native";
import { TintTile } from "@/components/ui/tint-tile";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import type { Tint } from "@/lib/tint";
import { THEME } from "@/lib/theme";

export function SwitchRow({
  icon,
  tint,
  label,
  hint,
  value,
  disabled,
  first,
  onChange,
}: {
  icon: Parameters<typeof TintTile>[0]["icon"];
  tint: Tint;
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  first?: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View
      className={
        first
          ? "min-h-[60px] flex-row items-center gap-3 py-2 ps-4 pe-3.5"
          : "min-h-[60px] flex-row items-center gap-3 border-t-hairline border-border py-2 ps-4 pe-3.5"
      }
    >
      <TintTile tint={tint} icon={icon} size={36} iconSize={19} className="rounded-[10px]" />
      <View className="flex-1 gap-0.5 py-1">
        <Text className="text-body text-foreground">{label}</Text>
        <Text className="text-footnote text-muted-foreground">{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: THEME[colorScheme].primary }}
        accessibilityLabel={label}
        accessibilityHint={hint}
        // React Native's Switch does not tell assistive technology it is disabled.
        accessibilityState={{ disabled: !!disabled, checked: value }}
      />
    </View>
  );
}

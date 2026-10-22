// One tappable row of a Settings card: an icon tile, the label, an optional
// value on the right, and a chevron (a screen in the app) or an arrow out (a
// page in the browser, an email). Rows after the first sit under a hairline.
// At the accessibility text sizes the label wraps and the value moves under it.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useRipple } from "@/components/ui/ripple";
import { useLargeText } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  /** Leaves the app (the browser, the mail app): an arrow out instead of a chevron. */
  external?: boolean;
  destructive?: boolean;
  first?: boolean;
  testID?: string;
  onPress: () => void;
}

export function SettingsRow({ icon, label, value, external, destructive, first, testID, onPress }: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const ripple = useRipple();
  const large = useLargeText();
  return (
    <Pressable
      android_ripple={ripple}
      accessibilityRole={external ? "link" : "button"}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      testID={testID}
      onPress={onPress}
      className={cn("min-h-[52px] flex-row items-center gap-3 py-2.5 pl-4 pr-3.5 active:bg-secondary", !first && "border-t-hairline border-border")}
    >
      <View className={cn("h-8 w-8 items-center justify-center rounded-[9px]", destructive ? "bg-destructive/10" : "bg-muted")}>
        <Ionicons name={icon} size={18} color={destructive ? theme.destructive : theme.mutedForeground} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={large ? undefined : 1} className={cn("text-body", destructive ? "font-semibold text-destructive" : "text-foreground")}>
          {label}
        </Text>
        {value && large ? <Text className="text-subhead text-muted-foreground">{value}</Text> : null}
      </View>
      {value && !large ? (
        <Text numberOfLines={1} className="max-w-[45%] text-right text-subhead text-muted-foreground">
          {value}
        </Text>
      ) : null}
      <Ionicons name={external ? "open-outline" : "chevron-forward"} size={external ? 16 : 18} color={theme.mutedForeground} />
    </Pressable>
  );
}

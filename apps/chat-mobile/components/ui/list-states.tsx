// What a list screen shows before its rows arrive and when they cannot be
// read: rows' outlines rather than a spinner (the inbox and the conversation
// have their own, room-list-parts.tsx and conversation-states.tsx), and an
// error that names what failed, says what to try and offers a retry. The error
// is announced the moment it appears: TalkBack through its live region,
// VoiceOver through useAnnounce, since a role alone says nothing until the
// reader reaches it.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";

/** [title width, line width] of each placeholder row: varied, so the outline reads as a list of people. */
const SKELETON_ROWS: readonly [number, number][] = [
  [132, 200],
  [104, 236],
  [150, 180],
  [118, 220],
  [96, 170],
  [140, 210],
];

/** The rows on their way: grey outlines of a face, a name and a line, read as one "Loading…" element. */
export function ListSkeleton({ label, square = false, testID }: { label?: string; square?: boolean; testID?: string }) {
  const { t } = useTranslation();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t("common.loading")}
      testID={testID}
      className="overflow-hidden pt-2"
    >
      {SKELETON_ROWS.map(([title, line], index) => (
        <View key={index} className="h-16 flex-row items-center gap-3 px-4">
          <View className="h-11 w-11 bg-muted" style={{ borderRadius: square ? 14 : 22 }} />
          <View className="flex-1 gap-2">
            <View className="h-3.5 rounded-full bg-muted" style={{ width: title }} />
            <View className="h-3 max-w-full rounded-full bg-muted" style={{ width: line }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The rows could not be read: what failed, what to try, and a retry; announced as it appears. */
export function ListLoadError({ title, onRetry, testID }: { title: string; onRetry: () => void; testID?: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const tap = useTapTarget(44);
  const hint = t("mobile.lists.load_failed_hint");
  useAnnounce(`${title}. ${hint}`);
  return (
    <View className="items-center px-8 py-12" testID={testID}>
      <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive" className="items-center gap-2">
        <View className="h-14 w-14 items-center justify-center rounded-[18px] bg-tint-red">
          <Ionicons name="cloud-offline-outline" size={26} color={theme.tintRedForeground} />
        </View>
        <Text className="mt-2 text-center text-headline font-display font-bold text-foreground">{title}</Text>
        <Text className="max-w-[300px] text-center text-callout text-muted-foreground">{hint}</Text>
      </View>
      <Pressable
        {...tap}
        accessibilityRole="button"
        // The label, not the children: the icon's glyph is a character a screen reader would spell.
        accessibilityLabel={t("common.retry")}
        onPress={onRetry}
        className="mt-5 min-h-11 flex-row items-center gap-2 rounded-full bg-muted px-[22px] py-2.5 active:opacity-80"
      >
        <Ionicons name="refresh" size={18} color={theme.foreground} />
        <Text className="text-subhead font-semibold text-foreground">{t("common.retry")}</Text>
      </Pressable>
    </View>
  );
}

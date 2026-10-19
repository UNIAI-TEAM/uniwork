// The Chat tab's pieces around the rows (MobileList, MobListStates boards):
// the workspace pill, the filter chips, and the loading, empty and error
// states. The tab screen owns the data; these only draw it.
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { ROOM_LIST_FILTERS, type RoomListFilter } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

type IconName = ComponentProps<typeof Ionicons>["name"];

const FILTER_LABEL: Record<RoomListFilter, string> = {
  all: "chat.filter_all",
  unread: "chat.filter_unread",
  mentions: "chat.filter_mentions",
  group: "chat.filter_group",
  channel: "chat.filter_channel",
};

/** The workspace the list belongs to; a tap opens the workspace switch. */
export function WorkspacePill(props: { name: string; seed?: string; iconUrl?: string | null; iconEmoji?: string | null; otherUnread?: number; onPress: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const other = props.otherUnread ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={other > 0 ? t("chat.mobile.workspace_pill_aria", { name: props.name, count: other }) : t("chat.mobile.workspace_pill_aria_quiet", { name: props.name })}
      onPress={props.onPress}
      className="h-11 max-w-[70%] flex-row items-center gap-2 rounded-full bg-muted pl-1.5 pr-2 active:opacity-80"
    >
      <WorkspaceAvatar name={props.name} iconUrl={props.iconUrl} iconEmoji={props.iconEmoji} size={30} seed={props.seed} />
      <Text className="shrink text-[15px] font-semibold text-foreground" numberOfLines={1}>
        {props.name}
      </Text>
      <Ionicons name="chevron-down" size={16} color={THEME[colorScheme].mutedForeground} />
      {/* Unread elsewhere in the organization: red, the way the MobileList board draws it. */}
      {other > 0 ? (
        <View className="h-[22px] min-w-[22px] items-center justify-center rounded-full bg-destructive-solid px-1.5">
          <Text className="text-xs font-display font-bold text-primary-foreground">{other > 99 ? "99+" : String(other)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** One chip at a time; "Nhắc tên" carries how many rooms mention the reader. */
export function FilterChips({ value, onChange, mentionRooms, total = 0 }: { value: RoomListFilter; onChange: (next: RoomListFilter) => void; mentionRooms: number; total?: number }) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t("chat.filter_aria")}
      className="grow-0"
      contentContainerClassName="gap-2 px-4 pb-2 pt-3"
      keyboardShouldPersistTaps="handled"
    >
      {ROOM_LIST_FILTERS.map((filter) => {
        const active = filter === value;
        const count = filter === "mentions" ? mentionRooms : 0;
        return (
          <Pressable
            key={filter}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={{ top: 5, bottom: 5 }}
            onPress={() => onChange(filter)}
            className={cn("h-[34px] flex-row items-center gap-1.5 rounded-full px-3.5", active ? "bg-primary" : "bg-muted active:opacity-80")}
          >
            <Text className={cn("text-sm font-semibold", active ? "text-primary-foreground" : "text-foreground")}>{t(FILTER_LABEL[filter])}</Text>
            {filter === "all" && total > 0 ? (
              <Text className={cn("text-xs", active ? "text-primary-foreground/90" : "text-muted-foreground")}>{String(total)}</Text>
            ) : null}
            {count > 0 ? (
              <View className={cn("h-[18px] min-w-[18px] items-center justify-center rounded-full px-[5px]", active ? "bg-primary-foreground" : "bg-primary")}>
                <Text className={cn("text-[11px] font-semibold", active ? "text-primary" : "text-primary-foreground")}>{count > 99 ? "99+" : String(count)}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const SKELETON_ROWS: [boolean, number, number][] = [
  [true, 132, 220],
  [false, 110, 250],
  [true, 150, 200],
  [true, 120, 236],
  [false, 96, 190],
  [true, 140, 228],
  [false, 116, 206],
];

export function RoomListSkeleton() {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} className="flex-1 overflow-hidden">
      <View className="flex-row gap-2 px-4 pb-2 pt-3">
        {[72, 88, 92, 64].map((width) => (
          <View key={width} className="h-[34px] rounded-full bg-muted" style={{ width }} />
        ))}
      </View>
      {SKELETON_ROWS.map(([room, title, preview], index) => (
        <View key={index} className="h-[76px] flex-row items-center gap-3 px-4">
          <View className="h-[54px] w-[54px] bg-muted" style={{ borderRadius: room ? 18 : 27 }} />
          <View className="flex-1 gap-2.5">
            <View className="flex-row items-center">
              <View className="h-3.5 rounded-full bg-muted" style={{ width: title }} />
              <View className="flex-1" />
              <View className="h-2.5 w-[34px] rounded-full bg-muted" />
            </View>
            <View className="h-3 max-w-full rounded-full bg-muted" style={{ width: preview }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function StateTile({ icon, tone }: { icon: IconName; tone: "blue" | "red" }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className={cn("h-16 w-16 items-center justify-center rounded-[20px]", tone === "red" ? "bg-tint-red" : "bg-tint-blue")}>
      <Ionicons name={icon} size={30} color={tone === "red" ? theme.tintRedForeground : theme.tintBlueForeground} />
    </View>
  );
}

function PillButton({ icon, label, primary = false, onPress }: { icon: IconName; label: string; primary?: boolean; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn("h-12 flex-row items-center justify-center gap-2 rounded-full px-6 active:opacity-80", primary ? "bg-primary" : "bg-muted")}
    >
      <Ionicons name={icon} size={20} color={primary ? theme.primaryForeground : theme.foreground} />
      <Text className={cn("text-base font-semibold", primary ? "text-primary-foreground" : "text-foreground")}>{label}</Text>
    </Pressable>
  );
}

const FILTER_HINT: Partial<Record<RoomListFilter, string>> = {
  unread: "chat.sidebar_filter_empty_unread_hint",
  mentions: "chat.sidebar_filter_empty_mentions_hint",
  channel: "chat.sidebar_filter_empty_channel_hint",
};

/** Nothing to show: no conversation yet, none of a chip's kind, or none matching the search. */
export function RoomListEmpty(props: { searching: boolean; filter: RoomListFilter; onStartDm: () => void; onBrowseChannels: () => void }) {
  const { t } = useTranslation();
  const { searching, filter } = props;
  if (searching) {
    return (
      <View className="items-center px-8 pt-24">
        <StateTile icon="search" tone="blue" />
        <Text className="mt-5 text-center text-lg font-display font-bold text-foreground">{t("chat.search_no_results")}</Text>
      </View>
    );
  }
  const filtered = filter !== "all";
  const hint = filtered ? FILTER_HINT[filter] : "chat.sidebar_empty_hint";
  return (
    <View className="items-center px-8 pt-24">
      <StateTile icon={filter === "channel" ? "compass-outline" : "chatbubbles-outline"} tone="blue" />
      <Text className="mt-5 text-center text-lg font-display font-bold text-foreground">
        {filtered ? t("chat.sidebar_filter_empty_title") : t("chat.sidebar_empty_title")}
      </Text>
      {hint ? <Text className="mt-1.5 max-w-[320px] text-center text-sm leading-5 text-muted-foreground">{t(hint)}</Text> : null}
      {!filtered || filter === "channel" ? (
        <View className="mt-6 w-full max-w-[280px] gap-2.5">
          {filtered ? null : <PillButton primary icon="create-outline" label={t("chat.start_dm_title")} onPress={props.onStartDm} />}
          <PillButton primary={filtered} icon="compass-outline" label={t("chat.channel.directory_title")} onPress={props.onBrowseChannels} />
        </View>
      ) : null}
    </View>
  );
}

export function RoomListError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  return (
    <View accessibilityRole="alert" className="flex-1 items-center px-8 pt-28">
      <StateTile icon="alert-circle-outline" tone="red" />
      <Text className="mt-5 max-w-[300px] text-center text-[17px] font-display font-bold leading-6 text-foreground">{t("chat.sidebar_load_failed")}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className="mt-5 h-11 flex-row items-center gap-2 rounded-full bg-muted px-[22px] active:opacity-80"
      >
        <Ionicons name="refresh" size={18} color={THEME[colorScheme].foreground} />
        <Text className="text-[15px] font-semibold text-foreground">{t("common.retry")}</Text>
      </Pressable>
    </View>
  );
}

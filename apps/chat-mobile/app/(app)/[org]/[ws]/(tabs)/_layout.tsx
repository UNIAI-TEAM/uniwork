// Ported from usf apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx with
// Ionicons instead of SF symbols (Android has none). Four tabs; the
// MobileList board's bar: brand when active, the filled glyph on the active tab.
// Labels grow with the system text size only to TAB_LABEL_MAX_FONT_SCALE, as a
// native tab bar keeps its labels fixed: at 200 % they would wrap and push the
// icons out of the bar.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { useChatWorkspace } from "@/components/chat/use-chat-workspace";
import { Text } from "@/components/ui/text";
import { unreadSummaryOptions } from "@/data/queries/chat";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { TAB_LABEL_MAX_FONT_SCALE } from "@/lib/type-scale";
import { badgeText, unreadForTabBadge } from "@/lib/workspace-unread";

type IconName = ComponentProps<typeof Ionicons>["name"];

const TABS: { name: string; label: string; icon: IconName; iconOutline: IconName }[] = [
  { name: "chat", label: "nav.chat", icon: "chatbubbles", iconOutline: "chatbubbles-outline" },
  { name: "calls", label: "mobile.tab_calls", icon: "call", iconOutline: "call-outline" },
  { name: "contacts", label: "nav.people", icon: "people", iconOutline: "people-outline" },
  { name: "settings", label: "nav.settings", icon: "settings", iconOutline: "settings-outline" },
];

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useTranslation();
  const chat = useChatWorkspace();
  const summary = useQuery({ ...unreadSummaryOptions(), enabled: Boolean(chat) });
  const chatBadge = chat ? badgeText(unreadForTabBadge(summary.data, chat.wsId)) : null;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            // The MobileList board's red count on the Chat tab.
            ...(tab.name === "chat" && chatBadge
              ? {
                  tabBarBadge: chatBadge,
                  tabBarBadgeStyle: {
                    backgroundColor: theme.destructiveSolid,
                    color: theme.primaryForeground,
                    fontSize: 11,
                    fontWeight: "700" as const,
                  },
                }
              : {}),
            tabBarLabel: ({ color, children }) => (
              <Text className="text-meta font-semibold" style={{ color }} maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE} numberOfLines={1}>
                {children}
              </Text>
            ),
            tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? tab.icon : tab.iconOutline} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}

// Ported from usf apps/mobile/app/(app)/[workspace]/(tabs)/_layout.tsx with
// Ionicons instead of SF symbols (Android has none). Four tabs of M1; the
// MobileList board's bar: brand when active, the filled glyph on the active tab.
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? tab.icon : tab.iconOutline} size={size} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}

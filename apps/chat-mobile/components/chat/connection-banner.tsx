// The one line that says the conversation is not live: "Waiting
// for a connection…" while the phone has no network, or a network that does
// not reach the internet (a captive portal, NetInfo's probe: lib/reachability.ts), "Connecting…"
// while the network is there but the workspace socket is dialing or waiting
// to redial. A blip shorter than RECONNECT_GRACE_MS shows nothing, so a
// healthy app never flickers it. Above the chat list and every conversation.
import { Ionicons } from "@expo/vector-icons";
import { useNetInfo } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useAnnounce } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { useConnectionState } from "@/data/realtime/realtime-provider";
import { isKnownOffline } from "@/lib/reachability";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";

export const RECONNECT_GRACE_MS = 1_500;

/** True once `on` has held for `ms`; false again at once. */
function useHeldFor(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return held;
}

export function ConnectionBanner() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const offline = isKnownOffline(useNetInfo());
  const connection = useConnectionState();
  const reconnecting = useHeldFor(!offline && (connection === "connecting" || connection === "waiting"), RECONNECT_GRACE_MS);
  const line = offline ? t("chat.mobile.offline_banner") : reconnecting ? t("chat.mobile.connecting_banner") : null;
  // VoiceOver has no live regions: it hears the line when it appears or changes.
  useAnnounce(line);
  if (!line) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      // For the Maestro flows, whatever language the device reads.
      testID={offline ? "connection-banner-offline" : "connection-banner-connecting"}
      className="flex-row items-center gap-2 bg-tint-yellow px-4 py-2"
    >
      <Ionicons name={offline ? "cloud-offline-outline" : "sync-outline"} size={16} color={theme.tintYellowForeground} />
      <Text className="text-footnote font-medium text-tint-yellow-foreground">{line}</Text>
    </View>
  );
}

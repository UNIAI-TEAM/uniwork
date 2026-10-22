// A visually hidden polite live region for Android: TalkBack reads its text
// each time it changes, once the reader is idle, without moving focus. iOS has
// no live regions (VoiceOver hears the same moment through
// announceForAccessibilityWithOptions), so nothing is drawn there. Clipped to
// a point rather than made transparent: TalkBack skips a view it cannot see.
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/text";

const HIDDEN = StyleSheet.create({ region: { position: "absolute", width: 1, height: 1, overflow: "hidden" } }).region;

export function LiveRegion({ line, testID }: { line: string | null; testID?: string }) {
  if (Platform.OS !== "android") return null;
  return (
    <View style={HIDDEN} accessibilityLiveRegion="polite" pointerEvents="none" testID={testID}>
      <Text>{line ?? ""}</Text>
    </View>
  );
}

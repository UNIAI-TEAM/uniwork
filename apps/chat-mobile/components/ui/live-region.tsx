// A visually hidden polite live region for Android: TalkBack reads its text
// each time it changes, once the reader is idle, without moving focus. iOS has
// no live regions (VoiceOver hears the same moment through
// announceForAccessibilityWithOptions), so nothing is drawn there. Clipped to
// a point rather than made transparent: TalkBack skips a view it cannot see.
// Android announces a change inside a region already attached, never a region
// that arrives with its text set: the region mounts empty and takes its line
// once it is on screen, so one that mounts with a failure still says it.
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "@/components/ui/text";

const HIDDEN = StyleSheet.create({ region: { position: "absolute", width: 1, height: 1, overflow: "hidden" } }).region;

export function LiveRegion({ line, testID }: { line: string | null; testID?: string }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    setShown(line);
  }, [line]);
  if (Platform.OS !== "android") return null;
  return (
    <View style={HIDDEN} accessibilityLiveRegion="polite" pointerEvents="none" testID={testID}>
      <Text>{shown ?? ""}</Text>
    </View>
  );
}

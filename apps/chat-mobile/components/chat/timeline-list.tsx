// The conversation's message list: the tuned inverted FlatList
// (message-list.tsx), or, where the unichat_mobile_timeline_recycled switch is
// on, the same list on FlashList 2 (recycled-message-list.tsx). The switch is
// read once per conversation shown: a config refetch never swaps the list
// under the reader's scroll; the next room opened follows it. The list drawn
// is a crash-report tag (timeline_list), so Sentry's slow and frozen frames of
// a conversation split by list: the A/B's device half.
//
// Either list dismisses the keyboard as the finger drags it down
// (keyboardDismissMode="interactive"), which React Native does on iOS only. On
// Android the list sits in react-native-keyboard-controller's
// KeyboardGestureArea, whose "ios" interpolator moves the keyboard once the
// finger reaches it, as Messages and WhatsApp do (Android 11+; older releases
// keep the tap-to-dismiss they had).
import { useEffect, useState } from "react";
import { Platform, StyleSheet } from "react-native";
import { KeyboardGestureArea } from "react-native-keyboard-controller";
import { useMobileFlag } from "@/data/remote-config";
import { setReportTag } from "@/data/report";
import { MessageList, type MessageListProps } from "./message-list";
import { RecycledMessageList } from "./recycled-message-list";

const FILL = StyleSheet.create({ fill: { flex: 1 } }).fill;

export function TimelineList(props: MessageListProps) {
  const flag = useMobileFlag("unichat_mobile_timeline_recycled");
  const [recycled] = useState(flag);
  useEffect(() => setReportTag("timeline_list", recycled ? "recycled" : "inverted"), [recycled]);
  const list = recycled ? <RecycledMessageList {...props} /> : <MessageList {...props} />;
  if (Platform.OS !== "android") return list;
  return (
    <KeyboardGestureArea interpolator="ios" style={FILL} testID="timeline-keyboard-area">
      {list}
    </KeyboardGestureArea>
  );
}

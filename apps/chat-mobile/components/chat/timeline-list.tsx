// The conversation's message list: the tuned inverted FlatList
// (message-list.tsx), or, where the unichat_mobile_timeline_recycled switch is
// on, the same list on FlashList 2 (recycled-message-list.tsx). The switch is
// read once per conversation shown: a config refetch never swaps the list
// under the reader's scroll; the next room opened follows it. The list drawn
// is a crash-report tag (timeline_list), so Sentry's slow and frozen frames of
// a conversation split by list: the A/B's device half.
import { useEffect, useState } from "react";
import { useMobileFlag } from "@/data/remote-config";
import { setReportTag } from "@/data/report";
import { MessageList, type MessageListProps } from "./message-list";
import { RecycledMessageList } from "./recycled-message-list";

export function TimelineList(props: MessageListProps) {
  const flag = useMobileFlag("unichat_mobile_timeline_recycled");
  const [recycled] = useState(flag);
  useEffect(() => setReportTag("timeline_list", recycled ? "recycled" : "inverted"), [recycled]);
  return recycled ? <RecycledMessageList {...props} /> : <MessageList {...props} />;
}

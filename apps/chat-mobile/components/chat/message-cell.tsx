// One cell of a conversation's list: the bubble its model describes
// (lib/message-row-model.ts), inside the swipe that quotes it, or, for a
// thread's root, above the "N trả lời" divider. Memoized on props that keep
// their identity while the row draws the same (the model, the card context,
// the scheme, one stable handlers object), so only rows that changed render.
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import type { MessageRowModel } from "@/lib/message-row-model";
import type { TimelineMessage } from "@/lib/timeline-display";
import type { MessageCardContext } from "./message-cards";
import { MessageRow } from "./message-row";
import { SwipeToReply } from "./swipe-to-reply";

/** What a row's taps do; one object for the whole list (components/chat/use-stable-handlers.ts). */
export interface MessageHandlers {
  onLongPress: (message: TimelineMessage) => void;
  onPressQuote: (messageId: string) => void;
  onPressThread: (message: TimelineMessage) => void;
  onPressPending: (message: TimelineMessage) => void;
  onToggleReaction: (message: TimelineMessage, emoji: string) => void;
  onReply: (message: TimelineMessage) => void;
}

interface Props {
  model: MessageRowModel;
  ctx: MessageCardContext;
  scheme: "light" | "dark";
  handlers: MessageHandlers;
}

/** A face the width of the canvas's 30 pt avatar. */
const AVATAR_SPACER = { width: 30 };

export const MessageCell = memo(function MessageCell({ model, ctx, scheme, handlers }: Props) {
  const { t } = useTranslation();
  const { message } = model;
  const bubble = (
    <MessageRow
      message={message}
      own={model.own}
      compactTop={model.compactTop}
      continued={model.continued}
      senderName={model.senderName}
      showSender={model.showSender}
      quote={model.quote}
      receipt={model.receipt}
      avatar={model.avatar === "face" ? <PersonAvatar name={model.senderName} size={30} seed={message.sender} /> : model.avatar === "spacer" ? <View style={AVATAR_SPACER} /> : undefined}
      album={model.album}
      ringed={model.root}
      highlighted={model.highlighted}
      showThread={model.showThread}
      ctx={ctx}
      scheme={scheme}
      taskIds={model.taskIds}
      onLongPress={handlers.onLongPress}
      onPressQuote={handlers.onPressQuote}
      onPressThread={handlers.onPressThread}
      onPressPending={handlers.onPressPending}
      onToggleReaction={handlers.onToggleReaction}
    />
  );
  if (!model.root) {
    return (
      <SwipeToReply enabled={model.swipeToReply} onReply={() => handlers.onReply(message)}>
        {bubble}
      </SwipeToReply>
    );
  }
  const label = t("chat.thread_replies", { count: model.threadReplies });
  // One view, so the root and its divider stay in order inside the inverted list's cell.
  return (
    <View>
      <View className="border-b border-primary/20 bg-primary/10 pb-3">{bubble}</View>
      {model.threadReplies > 0 ? (
        <View className="flex-row items-center gap-2.5 px-3 pb-1.5 pt-3.5" accessible accessibilityRole="header" accessibilityLabel={label}>
          <View className="h-px flex-1 bg-border" />
          <View className="rounded-full bg-chat-chip px-3 py-[3px]">
            <Text className="text-footnote font-semibold text-chat-chip-foreground">{label}</Text>
          </View>
          <View className="h-px flex-1 bg-border" />
        </View>
      ) : null}
    </View>
  );
});

// The long-press sheet of a message (spec §2.2): quick reactions on top, then
// reply, reply in a thread, copy, the message's follow-up (follow it later, or
// done / to a task / drop it) and "make a task" (M3, the web's ⋯ menu), and
// edit / delete for one's own message. A local message that did not go gets
// retry / delete instead.
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import type { ChatFollowUp } from "@/data/chat-api";
import { Text } from "@/components/ui/text";
import { messageView } from "@/lib/message-display";
import type { TimelineMessage } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";

/** No native emoji picker on the phone: the six everyone reaches for. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

interface Props {
  message: TimelineMessage | null;
  own: boolean;
  /** Inside a thread: a reply there is already in one, and the thread API takes no quote. */
  inThread: boolean;
  /** This person's open follow-up on the message, if any. */
  followUp: ChatFollowUp | null;
  onClose: () => void;
  onReact: (message: TimelineMessage, emoji: string) => void;
  onReply: (message: TimelineMessage) => void;
  onThread: (message: TimelineMessage) => void;
  onCopy: (message: TimelineMessage) => void;
  onEdit: (message: TimelineMessage) => void;
  onDelete: (message: TimelineMessage) => void;
  onFollowUp: (message: TimelineMessage, command: "create" | "complete" | "convert" | "remove") => void;
  onCreateTask: (message: TimelineMessage) => void;
  onRetry: (message: TimelineMessage) => void;
  onDiscard: (message: TimelineMessage) => void;
}

export function MessageActionsSheet(props: Props) {
  const { message, own, inThread, onClose } = props;
  const { t } = useTranslation();
  const record = message?.record;
  const actions: SheetAction[] = [];
  if (message?.pending) {
    if (message.pending.status !== "sending") actions.push({ key: "retry", label: t("chat.retry"), onPress: () => props.onRetry(message) });
    actions.push({ key: "discard", label: t("chat.action_delete"), destructive: true, onPress: () => props.onDiscard(message) });
  } else if (message && record) {
    if (!inThread) actions.push({ key: "reply", label: t("chat.action_reply"), onPress: () => props.onReply(message) });
    if (!inThread && !record.thread_root_id) actions.push({ key: "thread", label: t("chat.action_thread"), onPress: () => props.onThread(message) });
    if (messageView(record) === "text") actions.push({ key: "copy", label: t("chat.action_copy"), onPress: () => props.onCopy(message) });
    if (props.followUp) {
      actions.push(
        { key: "follow-up-complete", label: t("chat.follow_up.complete"), onPress: () => props.onFollowUp(message, "complete") },
        { key: "follow-up-convert", label: t("chat.follow_up.convert"), onPress: () => props.onFollowUp(message, "convert") },
        { key: "follow-up-remove", label: t("chat.mobile.follow_up_remove"), onPress: () => props.onFollowUp(message, "remove") },
      );
    } else {
      actions.push({ key: "follow-up", label: t("chat.follow_up.action"), onPress: () => props.onFollowUp(message, "create") });
    }
    actions.push({ key: "task", label: t("chat.link.create_task"), onPress: () => props.onCreateTask(message) });
    if (own && messageView(record) === "text") actions.push({ key: "edit", label: t("chat.action_edit"), onPress: () => props.onEdit(message) });
    if (own) actions.push({ key: "delete", label: t("chat.action_delete"), destructive: true, onPress: () => props.onDelete(message) });
  }
  const mine = new Set(record?.my_reactions ?? []);
  const header =
    message && record ? (
      <View className="flex-row justify-around px-3 py-2">
        {QUICK_REACTIONS.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={emoji}
            accessibilityState={{ selected: mine.has(emoji) }}
            onPress={() => {
              onClose();
              props.onReact(message, emoji);
            }}
            className={cn("h-12 w-12 items-center justify-center rounded-full", mine.has(emoji) ? "bg-primary/15" : "active:bg-secondary")}
          >
            <Text className="text-2xl">{emoji}</Text>
          </Pressable>
        ))}
      </View>
    ) : null;
  return <ActionSheet visible={message !== null} onClose={onClose} header={header} actions={actions} />;
}

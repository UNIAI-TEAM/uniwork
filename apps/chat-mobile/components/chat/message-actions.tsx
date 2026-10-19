// The long-press menu of a message (spec §2.2, canvas MobileActions): over a
// dimmed screen, the quick reactions, the message itself lifted out, and a
// menu card — reply, reply in a thread, copy; "make a task" (M3, the web's ⋯
// menu) and the message's follow-up (follow it later, or done / to a task /
// drop it); edit / delete for one's own message. A local message that did not
// go gets retry / delete instead.
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Platform, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PersonAvatar } from "@/components/people/person-avatar";
import { useAfterDismiss } from "@/components/ui/action-sheet";
import { Text } from "@/components/ui/text";
import { FOLLOW_UP_HOURS } from "@/data/chat-actions";
import type { ChatFollowUp } from "@/data/chat-api";
import { deserializeMessageBodyToComposerDraft } from "@/lib/mentions";
import { messagePreviewText, messageView } from "@/lib/message-display";
import { senderNameClass } from "@/lib/sender-colors";
import { THEME } from "@/lib/theme";
import { formatMessageTime, type TimelineMessage } from "@/lib/timeline-display";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

/** The six quick reactions of the MobileActions board, named for VoiceOver/TalkBack; "Thêm cảm xúc" opens the rest. */
const QUICK_REACTIONS = [
  ["👍", "chat.mobile.react_label_like"],
  ["❤️", "chat.mobile.react_label_love"],
  ["😂", "chat.mobile.react_label_haha"],
  ["🎉", "chat.mobile.react_label_party"],
  ["😮", "chat.mobile.react_label_wow"],
  ["🙏", "chat.mobile.react_label_thanks"],
] as const;

interface Props {
  message: TimelineMessage | null;
  own: boolean;
  /** Inside a thread: a reply there is already in one, and the thread API takes no quote. */
  inThread: boolean;
  /** This person's open follow-up on the message, if any. */
  followUp: ChatFollowUp | null;
  /** Printed over someone else's lifted bubble, as in a group's run. */
  senderName?: string;
  /** Someone else's face beside the lifted bubble in a group (the board indents the bar and the menu past it). */
  avatar?: ReactNode;
  /** Who has read this message in a group or channel ("n người đã xem"), the sender excluded; empty in a DM. */
  seenBy?: readonly { user_id: string; display_name: string }[];
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
  onMoreReactions: (message: TimelineMessage) => void;
  onPin: (message: TimelineMessage) => void;
  onForward: (message: TimelineMessage) => void;
}

interface MenuItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Rows of one group sit under a hairline; a new group gets a thick divider. */
  group: number;
  destructive?: boolean;
  /** Small grey text at the row's end ("Giữ liên kết"). */
  hint?: string;
  onPress: () => void;
}

export function MessageActionsSheet(props: Props) {
  const { message, own, inThread, onClose } = props;
  const { t, i18n } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { choose, onDismiss } = useAfterDismiss(onClose);
  const record = message?.record;
  const items: MenuItem[] = [];
  if (message?.pending) {
    if (message.pending.status !== "sending") items.push({ key: "retry", group: 0, icon: "refresh-outline", label: t("chat.retry"), onPress: () => props.onRetry(message) });
    items.push({ key: "discard", group: 1, icon: "trash-outline", label: t("chat.action_delete"), destructive: true, onPress: () => props.onDiscard(message) });
  } else if (message && record) {
    const text = messageView(record) === "text";
    if (!inThread) items.push({ key: "reply", group: 0, icon: "arrow-undo-outline", label: t("chat.action_reply"), onPress: () => props.onReply(message) });
    if (!inThread && !record.thread_root_id)
      items.push({ key: "thread", group: 0, icon: "chatbubble-ellipses-outline", label: t("chat.action_thread"), onPress: () => props.onThread(message) });
    if (text) items.push({ key: "copy", group: 0, icon: "copy-outline", label: t("chat.action_copy"), onPress: () => props.onCopy(message) });
    items.push({ key: "pin", group: 0, icon: record.pinned ? "pin" : "pin-outline", label: t(record.pinned ? "chat.action_unpin" : "chat.action_pin"), onPress: () => props.onPin(message) });
    items.push({ key: "task", group: 1, icon: "checkmark-circle-outline", label: t("chat.link.create_task"), hint: t("chat.mobile.task_hint_link"), onPress: () => props.onCreateTask(message) });
    if (props.followUp) {
      items.push(
        { key: "follow-up-complete", group: 1, icon: "checkmark-done-outline", label: t("chat.follow_up.complete"), onPress: () => props.onFollowUp(message, "complete") },
        { key: "follow-up-convert", group: 1, icon: "swap-horizontal-outline", label: t("chat.follow_up.convert"), onPress: () => props.onFollowUp(message, "convert") },
        { key: "follow-up-remove", group: 1, icon: "close-circle-outline", label: t("chat.mobile.follow_up_remove"), onPress: () => props.onFollowUp(message, "remove") },
      );
    } else {
      items.push({ key: "follow-up", group: 1, icon: "alarm-outline", label: t("chat.follow_up.action"), hint: t("chat.mobile.follow_up_hint", { hours: FOLLOW_UP_HOURS }), onPress: () => props.onFollowUp(message, "create") });
    }
    items.push({ key: "forward", group: 1, icon: "arrow-redo-outline", label: t("chat.forward.action"), onPress: () => props.onForward(message) });
    if (own && text) items.push({ key: "edit", group: 2, icon: "create-outline", label: t("chat.action_edit"), onPress: () => props.onEdit(message) });
    if (own) items.push({ key: "delete", group: 2, icon: "trash-outline", label: t("chat.action_delete"), destructive: true, onPress: () => props.onDelete(message) });
  }
  const mine = new Set(record?.my_reactions ?? []);
  const pending = message?.pending;
  const preview = record
    ? messagePreviewText(record, t)
    : pending
      ? pending.file
        ? pending.file.name
        : deserializeMessageBodyToComposerDraft(pending.body)
      : "";

  return (
    <Modal visible={message !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose} onDismiss={onDismiss}>
      {/* The wall blurred and dimmed behind the sheet (MobileActions board); Android blurs only where the runtime can. */}
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")}>
        <BlurView intensity={30} tint="dark" experimentalBlurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined} style={{ flex: 1 }}>
          <View className="flex-1 bg-black/35" />
        </BlurView>
      </Pressable>
      {/* box-none: a tap between the pieces reaches the backdrop and closes. */}
      <SafeAreaView pointerEvents="box-none" className={cn("flex-1 justify-center gap-2.5 px-4", own ? "items-end" : "items-start")}>
        {message && record ? (
          <View className={cn("flex-row items-center gap-0.5 rounded-full bg-card p-1.5 shadow-lg", props.avatar && "ml-9")}>
            {QUICK_REACTIONS.map(([emoji, labelKey]) => (
              <Pressable
                key={emoji}
                accessibilityRole="button"
                accessibilityLabel={t(labelKey)}
                accessibilityState={{ selected: mine.has(emoji) }}
                onPress={() => {
                  onClose();
                  props.onReact(message, emoji);
                }}
                className={cn("h-11 w-11 items-center justify-center rounded-full", mine.has(emoji) ? "bg-primary/15" : "active:bg-secondary")}
              >
                <Text className="text-[26px] leading-[32px]">{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.action_react_more")}
              onPress={() => choose(() => props.onMoreReactions(message))}
              className="h-10 w-10 items-center justify-center rounded-full bg-muted active:bg-secondary"
            >
              <Ionicons name="chevron-down" size={20} color={theme.mutedForeground} />
            </Pressable>
          </View>
        ) : null}
        {message ? (
          <View className="max-w-full flex-row items-end gap-1.5">
          {props.avatar}
          <View className={cn("max-w-[85%] rounded-[18px] px-3 pb-1.5 pt-1.5 shadow-lg", own ? "rounded-br-[4px] bg-chat-bubble-own" : "rounded-bl-[4px] bg-chat-bubble-other")}>
            {!own && props.senderName ? (
              <Text className={cn("text-[13px] font-semibold", senderNameClass(message.sender))} numberOfLines={1}>
                {props.senderName}
              </Text>
            ) : null}
            <Text className={cn("text-base", own ? "text-chat-bubble-own-foreground" : "text-foreground")} numberOfLines={6}>
              {preview}
            </Text>
            <Text className={cn("self-end text-[11px]", own ? "text-chat-bubble-own-meta" : "text-muted-foreground")}>{formatMessageTime(message.ts, i18n.language)}</Text>
          </View>
          </View>
        ) : null}
        {items.length > 0 ? (
          <View className={cn("w-64 overflow-hidden rounded-2xl bg-card shadow-xl", props.avatar && "ml-9")}>
            {props.seenBy && props.seenBy.length > 0 ? (
              <View className="min-h-12 flex-row items-center gap-2.5 px-3.5" accessible accessibilityLabel={t("chat.seen_by_count", { count: props.seenBy.length })}>
                <Ionicons name="checkmark-done" size={20} color={theme.primary} />
                <Text className="flex-1 text-[15px] text-foreground">{t("chat.seen_by_count", { count: props.seenBy.length })}</Text>
                <View className="flex-row">
                  {props.seenBy.slice(0, 3).map((member, index) => (
                    <View key={member.user_id} className={cn("rounded-full border-2 border-card", index > 0 && "-ml-2")}>
                      <PersonAvatar name={member.display_name} size={22} seed={member.user_id} />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {items.map((item, index) => {
              const divider = (index > 0 && items[index - 1]?.group !== item.group) || (index === 0 && Boolean(props.seenBy?.length));
              return (
                <View key={item.key}>
                  {divider ? <View className="h-1.5 bg-muted" /> : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => choose(item.onPress)}
                    className={cn("min-h-[46px] flex-row items-center gap-3 px-3.5 active:bg-secondary", index > 0 && !divider && "border-t border-border")}
                  >
                    <Ionicons name={item.icon} size={20} color={item.destructive ? theme.destructive : theme.mutedForeground} />
                    <Text className={cn("flex-1 text-[15px]", item.destructive ? "text-destructive" : "text-foreground")}>{item.label}</Text>
                    {item.hint ? <Text className="text-xs text-muted-foreground">{item.hint}</Text> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

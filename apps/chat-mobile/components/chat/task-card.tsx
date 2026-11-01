// The tasks under a message (the web's message-task-card.tsx). A task made from
// the message is a bubble: the line saying so, the board card (priority, id,
// title, assignee, unlink), and the message's time. A task only linked to it
// is one line. A tap opens the task on the web.
import { Ionicons } from "@expo/vector-icons";
import { deserializeMessageBodyToComposerDraft } from "@uniwork/core/chat/chat-mention-utils";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { Text } from "@/components/ui/text";
import { useUnlinkMessage } from "@/data/mutations/messages";
import { taskOptions } from "@/data/queries/chat";
import { toast } from "@/data/stores/toast-store";
import type { MessageTaskRef } from "@/lib/link-windows";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { MessageCardContext } from "./message-cards";

const BAR_HEIGHTS = [6, 9, 12];

function priorityInk(priority: string, scheme: "light" | "dark"): string {
  const theme = THEME[scheme];
  if (priority === "urgent") return theme.tintRedForeground;
  if (priority === "high") return theme.tintOrangeForeground;
  if (priority === "medium") return theme.tintBlueForeground;
  return theme.mutedForeground;
}

/** The board's priority mark: a dash, or three bars with the filled ones in the priority's ink. */
function PriorityMark({ priority }: { priority: string }) {
  const { colorScheme } = useColorScheme();
  const ink = priorityInk(priority, colorScheme);
  const filled = priority === "low" ? 1 : priority === "medium" ? 2 : priority === "high" || priority === "urgent" ? 3 : 0;
  if (filled === 0) {
    return (
      <View className="h-3.5 w-3.5 justify-center">
        <View style={{ height: 1.5, width: 10, backgroundColor: ink }} />
      </View>
    );
  }
  return (
    <View className="h-3.5 w-3.5 flex-row items-end justify-between">
      {BAR_HEIGHTS.map((height, index) => (
        <View
          key={height}
          style={{ width: 3, height, borderRadius: 1, backgroundColor: ink, opacity: index < filled ? 1 : 0.28 }}
        />
      ))}
    </View>
  );
}

function useTaskLine(ctx: MessageCardContext, taskId: string) {
  const { t } = useTranslation();
  const { data: task } = useQuery(taskOptions(ctx.wsId, taskId));
  const title = deserializeMessageBodyToComposerDraft(task?.title || t("chat.link.task_loading"));
  const identifier = task?.identifier || taskId.slice(0, 8);
  return { task, title, identifier };
}

function openTask(ctx: MessageCardContext, taskId: string) {
  void WebBrowser.openBrowserAsync(`${runtimeConfig().appUrl}${paths.workspace(ctx.orgSlug, ctx.wsSlug).task(taskId)}`);
}

function BoardCard({ ctx, link, messageId }: { ctx: MessageCardContext; link: MessageTaskRef; messageId: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const unlink = useUnlinkMessage(ctx.wsId, ctx.roomId);
  const { task, title, identifier } = useTaskLine(ctx, link.taskId);
  const assignee = task ? task.assignee?.display_name || t("tasks.unassigned") : "";
  const onUnlink = () => {
    Alert.alert(t("chat.message_list.unlink_confirm_title"), t("chat.message_list.unlink_confirm_description", { title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.link.unlink"),
        style: "destructive",
        onPress: () => {
          void unlink.mutateAsync({ messageId, linkId: link.linkId }).catch(() => toast.error(t("chat.message_list.unlink_failed")));
        },
      },
    ]);
  };
  return (
    <View className="relative">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t("chat.link.open_task", { identifier, title })}
        testID="message-task-card"
        onPress={() => openTask(ctx, link.taskId)}
        className="rounded-lg border border-border bg-card px-2.5 py-3 pe-11 active:bg-secondary"
      >
        <View className="flex-row items-center gap-1.5">
          {task?.priority ? <PriorityMark priority={task.priority} /> : null}
          <Text className="text-caption text-muted-foreground">{identifier}</Text>
        </View>
        <Text className="mt-1 text-body font-medium text-foreground" numberOfLines={2}>
          {title}
        </Text>
        {assignee ? (
          <Text className="mt-2 text-caption text-muted-foreground" numberOfLines={1}>
            {assignee}
          </Text>
        ) : null}
      </Pressable>
      {link.linkId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.message_list.unlink_named", { identifier, title })}
          hitSlop={4}
          onPress={onUnlink}
          className="absolute right-0 top-0 h-11 w-11 items-center justify-center"
        >
          <Ionicons name="close" size={16} color={THEME[colorScheme].mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function CompactCard({ ctx, taskId }: { ctx: MessageCardContext; taskId: string }) {
  const { t } = useTranslation();
  const { task, title, identifier } = useTaskLine(ctx, taskId);
  const status = task?.status ? t(`tasks.status_${task.status}`, { defaultValue: task.status }) : "";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[t("chat.link.open_task", { identifier, title }), status].filter(Boolean).join(", ")}
      testID="message-task-card"
      onPress={() => openTask(ctx, taskId)}
      className={
        "min-h-[52px] w-full flex-row items-center gap-2.5 rounded-xl border border-border bg-chat-bubble-other px-2.5 py-1.5 active:bg-secondary"
      }
    >
      <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={1}>
        <Text className="text-body text-muted-foreground">{identifier} · </Text>
        <Text className="text-body font-medium text-foreground">{title}</Text>
      </Text>
      {status ? <Text className="text-caption font-semibold text-primary">{status}</Text> : null}
    </Pressable>
  );
}

export function TaskCards({
  ctx,
  links,
  own,
  messageId,
  meta,
}: {
  ctx: MessageCardContext;
  links: readonly MessageTaskRef[];
  own: boolean;
  messageId: string;
  /** The message's time and ticks, drawn at the foot of a card made from the message. */
  meta?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const created = links.filter((link) => link.relation === "created_from");
  const linked = links.filter((link) => link.relation !== "created_from");
  return (
    <View className={cn("mt-1 w-full max-w-[85%] gap-1.5", own && "self-end")}>
      {created.length > 0 ? (
        <View className="w-full gap-1.5 rounded-2xl bg-chat-bubble-other px-2.5 py-2">
          <View className="flex-row items-center gap-1.5 px-0.5">
            <Ionicons name="checkmark-circle-outline" size={14} color={THEME[colorScheme].mutedForeground} />
            <Text className="flex-1 text-caption text-muted-foreground">
              {t(own ? "chat.link.card_created_from_yours" : "chat.link.card_created_from_this")}
            </Text>
          </View>
          {created.map((link) => (
            <BoardCard key={link.linkId || link.taskId} ctx={ctx} link={link} messageId={messageId} />
          ))}
          {meta ? <View className="flex-row justify-end px-0.5">{meta}</View> : null}
        </View>
      ) : null}
      {linked.map((link) => (
        <CompactCard key={link.linkId || link.taskId} ctx={ctx} taskId={link.taskId} />
      ))}
    </View>
  );
}

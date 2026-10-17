// The tasks a message was turned into, under it (the web's
// message-task-card.tsx): the task's id, title and status in the tasks'
// own words; a tap opens the task on the web, where it is edited.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { taskOptions } from "@/data/queries/chat";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import type { MessageCardContext } from "./message-cards";

function TaskCard({ ctx, taskId }: { ctx: MessageCardContext; taskId: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const { data: task } = useQuery(taskOptions(ctx.wsId, taskId));
  const title = task?.title || t("chat.link.task_loading");
  const identifier = task?.identifier || taskId.slice(0, 8);
  const status = task?.status ? t(`tasks.status_${task.status}`, { defaultValue: task.status }) : "";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={[t("chat.link.open_task", { identifier, title }), status].filter(Boolean).join(", ")}
      testID="message-task-card"
      // The in-app browser does not follow universal links, so this stays on the web.
      onPress={() => void WebBrowser.openBrowserAsync(`${runtimeConfig().appUrl}${paths.workspace(ctx.orgSlug, ctx.wsSlug).task(taskId)}`)}
      className="min-h-11 flex-row items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 active:bg-secondary"
    >
      <Ionicons name="checkbox-outline" size={16} color={THEME[colorScheme].mutedForeground} />
      <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
        <Text className="text-xs text-muted-foreground">{identifier}</Text> · {title}
      </Text>
      {status ? <Text className="text-xs text-muted-foreground">{status}</Text> : null}
    </Pressable>
  );
}

export function TaskCards({ ctx, taskIds, own }: { ctx: MessageCardContext; taskIds: readonly string[]; own: boolean }) {
  return (
    <View className={own ? "mt-1 w-[85%] items-end gap-1" : "mt-1 w-[85%] gap-1"}>
      {taskIds.map((id) => (
        <TaskCard key={id} ctx={ctx} taskId={id} />
      ))}
    </View>
  );
}

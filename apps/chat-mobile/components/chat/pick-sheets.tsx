// Picking a document to share into the room, or an existing task to link under
// a message. Both lists are the workspace's; a search narrows them.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { foldedIncludes } from "@uniwork/core/chat/search-fold";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SearchField } from "@/components/ui/search-field";
import { Text } from "@/components/ui/text";
import { documentPickOptions, taskPickOptions } from "@/data/queries/chat";
import { FormSheetHeader } from "./form-sheet";

export function DocumentPickSheet({
  wsId,
  visible,
  onClose,
  onPick,
}: {
  wsId: string;
  visible: boolean;
  onClose: () => void;
  onPick: (document: { id: string; title: string }) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const documents = useQuery({ ...documentPickOptions(wsId, q), enabled: visible });
  const query = q.trim();
  const rows = documents.data ?? [];
  return (
    <BottomSheet visible={visible} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <FormSheetHeader title={t("chat.document_picker.title")} description={t("chat.document_picker.description")} onClose={onClose} />
      <View className="px-4">
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t("chat.document_picker.search_placeholder")}
          accessibilityLabel={t("chat.document_picker.search_label")}
          className="mb-2"
        />
        {documents.isFetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.document_picker.loading")} /> : null}
        {rows.map((document) => (
          <Pressable
            key={document.id}
            accessibilityRole="button"
            accessibilityLabel={document.title}
            onPress={() => {
              onPick(document);
              onClose();
            }}
            className="min-h-11 justify-center rounded-lg px-3 py-2 active:bg-muted"
          >
            <Text className="text-body text-foreground" numberOfLines={1}>
              {document.title || t("chat.composer_attach_document")}
            </Text>
          </Pressable>
        ))}
        {!documents.isFetching && rows.length === 0 ? (
          <Text className="py-3 text-callout text-muted-foreground">
            {query ? t("chat.document_picker.empty_search_title", { query }) : t("chat.document_picker.empty_title")}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

export function LinkTaskSheet({
  wsId,
  message,
  onClose,
  onLink,
}: {
  wsId: string;
  message: ChatMessageRecord | null;
  onClose: () => void;
  onLink: (messageId: string, taskId: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const tasks = useQuery({ ...taskPickOptions(wsId), enabled: message !== null });
  const rows = (tasks.data ?? []).filter((task) => {
    const query = q.trim();
    if (!query) return true;
    return foldedIncludes(task.title, query) || foldedIncludes(task.identifier, query) || foldedIncludes(task.id, query);
  });
  const query = q.trim();
  return (
    <BottomSheet visible={message !== null} onClose={onClose} avoidKeyboard dragFrom="handle" className="px-0">
      <FormSheetHeader title={t("chat.link.link_task_title")} description={t("chat.link.link_task_description")} onClose={onClose} />
      <View className="px-4 pb-3">
        <SearchField
          value={q}
          onChangeText={setQ}
          placeholder={t("chat.link.search_placeholder")}
          accessibilityLabel={t("chat.link.search_label")}
          className="mb-2"
        />
        {tasks.isFetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.link.loading")} /> : null}
        {rows.map((task) => (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            accessibilityLabel={task.identifier ? `${task.identifier} ${task.title}` : task.title}
            onPress={() => {
              if (message) onLink(message.id, task.id);
              onClose();
            }}
            className="min-h-11 justify-center rounded-lg px-3 py-2 active:bg-muted"
          >
            {task.identifier ? <Text className="text-caption text-muted-foreground">{task.identifier}</Text> : null}
            <Text className="text-body text-foreground" numberOfLines={1}>
              {task.title}
            </Text>
          </Pressable>
        ))}
        {!tasks.isFetching && rows.length === 0 ? (
          <Text className="py-3 text-callout text-muted-foreground">{query ? t("chat.link.empty") : t("chat.link.empty_workspace")}</Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

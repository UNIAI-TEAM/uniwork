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
  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4">
      <Text className="mb-3 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.document_picker.title")}
      </Text>
      <SearchField
        value={q}
        onChangeText={setQ}
        placeholder={t("chat.document_picker.search_placeholder")}
        accessibilityLabel={t("chat.document_picker.search_label")}
        className="mb-2"
      />
      {documents.isFetching ? <ActivityIndicator className="py-3" accessibilityLabel={t("chat.document_picker.loading")} /> : null}
      {(documents.data ?? []).map((document) => (
        <Pressable
          key={document.id}
          accessibilityRole="button"
          accessibilityLabel={document.title}
          onPress={() => {
            onPick(document);
            onClose();
          }}
          className="min-h-12 justify-center border-b border-border py-2 active:bg-secondary"
        >
          <Text className="text-body text-foreground" numberOfLines={1}>
            {document.title || t("chat.composer_attach_document")}
          </Text>
        </Pressable>
      ))}
      {q.trim().length > 0 && documents.data?.length === 0 ? (
        <Text className="py-3 text-callout text-muted-foreground">{t("chat.document_picker.empty_search_title", { query: q.trim() })}</Text>
      ) : null}
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
  return (
    <BottomSheet visible={message !== null} onClose={onClose} className="px-4">
      <Text className="mb-3 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.link.link_task_title")}
      </Text>
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
          className="min-h-12 justify-center border-b border-border py-2 active:bg-secondary"
        >
          <Text className="text-body text-foreground" numberOfLines={1}>
            {task.identifier ? `${task.identifier} · ${task.title}` : task.title}
          </Text>
        </Pressable>
      ))}
      {q.trim().length > 0 && rows.length === 0 ? <Text className="py-3 text-callout text-muted-foreground">{t("chat.link.empty")}</Text> : null}
      <View />
    </BottomSheet>
  );
}

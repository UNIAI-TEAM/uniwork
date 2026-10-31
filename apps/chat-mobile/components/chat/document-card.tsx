// A document shared into the room. Without access the card names nothing about
// the document and only offers a request; with access it shows the title and
// opens the document on the web.
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { TintTile } from "@/components/ui/tint-tile";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { useRequestDocumentAccess } from "@/data/mutations/messages";
import { toast } from "@/data/stores/toast-store";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

type DocumentBlock = NonNullable<ChatMessageRecord["document"]>;

export function DocumentCard({
  document: doc,
  own,
  orgSlug,
  wsSlug,
}: {
  document: DocumentBlock;
  own: boolean;
  orgSlug: string;
  wsSlug: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const request = useRequestDocumentAccess();
  const [sent, setSent] = useState(false);
  const locked = doc.viewer_has_access === false;
  const text = own ? "text-chat-bubble-own-foreground" : "text-foreground";
  const open = () => {
    const href = paths.workspace(orgSlug, wsSlug).document(doc.document_id);
    void WebBrowser.openBrowserAsync(`${runtimeConfig().appUrl}${href}`);
  };
  const ask = () => {
    if (request.isPending || sent) return;
    void request
      .mutateAsync(doc.document_id)
      .then(() => {
        setSent(true);
        toast.success(t("chat.document_access_sent"));
      })
      .catch(() => toast.error(t("chat.document_access_failed")));
  };
  return (
    <View className="min-w-[200px] gap-2">
      <View className="flex-row items-center gap-2">
        <TintTile tint="blue" icon={locked ? "lock-closed-outline" : "document-outline"} size={32} iconSize={16} className="rounded-control" />
        <Text className={cn("flex-1 text-callout font-semibold", text)} numberOfLines={2}>
          {locked ? t("chat.document_locked_title") : (doc.title ?? t("chat.composer_attach_document"))}
        </Text>
      </View>
      {locked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.document_request_access")}
          onPress={ask}
          className="min-h-11 justify-center"
        >
          <Text className={cn("text-callout font-semibold", own ? "text-chat-bubble-own-foreground underline" : "text-primary")}>
            {sent ? t("chat.document_access_sent") : t("chat.document_request_access")}
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={doc.title ?? t("chat.channel.open")}
          onPress={open}
          className="min-h-11 flex-row items-center gap-1.5"
        >
          <Ionicons name="open-outline" size={16} color={own ? theme.chatBubbleOwnForeground : theme.primary} />
          <Text className={cn("text-callout font-semibold", own ? "text-chat-bubble-own-foreground underline" : "text-primary")}>
            {t("chat.channel.open")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

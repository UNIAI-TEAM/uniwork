// The sticker and GIF picker (M3), the phone's chat-expression-picker.tsx:
// two tabs, the trending set or a search, a tap sends. The items come from the
// server (Tenor); without TENOR_API_KEY it answers none and the empty line
// says so. A pick is sent as the same text body the web sends.
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { expressionsOptions } from "@/data/queries/chat";
import { formatChatMediaMessageBody } from "@/lib/media-body";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

type Kind = "stickers" | "gifs";

export function ExpressionSheet({ wsId, visible, onClose, onPick }: { wsId: string; visible: boolean; onClose: () => void; onPick: (body: string) => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const [kind, setKind] = useState<Kind>("stickers");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  // One request per pause in typing, not per letter.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q), 350);
    return () => clearTimeout(timer);
  }, [q]);
  const items = useQuery({ ...expressionsOptions(wsId, kind, search), enabled: visible });
  const columns = kind === "stickers" ? 4 : 2;
  const tabs: [Kind, string][] = [
    ["stickers", t("chat.expression_tab_sticker")],
    ["gifs", t("chat.expression_tab_gif")],
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
      <SafeAreaView edges={["bottom"]} className="h-[70%] rounded-t-2xl border-t border-border bg-background" testID="expression-sheet">
        <View className="flex-row gap-2 px-4 pt-3" accessibilityRole="tablist">
          {tabs.map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityState={{ selected: kind === value }}
              onPress={() => setKind(value)}
              className={cn("min-h-11 justify-center rounded-full px-4", kind === value ? "bg-primary" : "bg-secondary")}
            >
              <Text className={cn("text-sm font-medium", kind === value ? "text-primary-foreground" : "text-foreground")}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t(kind === "stickers" ? "chat.expression_search_stickers" : "chat.expression_search_gifs")}
          placeholderTextColor={THEME[colorScheme].mutedForeground}
          accessibilityLabel={t(kind === "stickers" ? "chat.expression_search_stickers" : "chat.expression_search_gifs")}
          className="mx-4 my-3 min-h-11 rounded-xl bg-secondary px-4 text-base text-foreground"
        />
        <FlatList
          key={kind}
          data={items.data ?? []}
          numColumns={columns}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-3 pb-4"
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => {
                onClose();
                onPick(formatChatMediaMessageBody(item.url, `${kind === "stickers" ? "sticker" : "gif"}:${item.label}`));
              }}
              className="p-1"
              style={{ width: `${100 / columns}%` }}
            >
              <Image source={{ uri: item.previewUrl }} contentFit="contain" style={{ width: "100%", aspectRatio: kind === "stickers" ? 1 : 16 / 10, borderRadius: 8 }} />
            </Pressable>
          )}
          ListEmptyComponent={
            items.isPending ? (
              <ActivityIndicator className="py-10" accessibilityLabel={t("common.loading")} />
            ) : (
              <Text className="px-6 py-10 text-center text-sm text-muted-foreground">
                {t(kind === "stickers" ? "chat.expression_stickers_empty" : "chat.expression_gifs_empty")}
              </Text>
            )
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

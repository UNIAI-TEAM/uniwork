// An album bubble's photos (canvas MobileChat): a 2-column grid inside a 3 pt
// frame; with an odd count the first photo spans the row, the rest go in
// pairs; past four the last tile says how many more. A tap opens that photo in
// the viewer, which pages through the conversation's photos.
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { TimelineMessage } from "@/lib/timeline-display";
import type { MessageCardContext } from "./message-cards";
import { useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media";

const GRID_WIDTH = 262;
const GAP = 3;
const VISIBLE = 4;

function Tile({ message, ctx, width, height, more, corners, onLongPress }: { message: TimelineMessage; ctx: MessageCardContext; width: number; height: number; more: number; corners: object; onLongPress: () => void }) {
  const { t } = useTranslation();
  const file = message.record!.file!;
  const src = useChatMediaSrc(ctx.wsId, ctx.roomId, message.id, file.thumb_url || file.url, file.url_expires_at);
  const freshUrl = useFreshChatMediaUrl(ctx.wsId, ctx.roomId);
  const open = () =>
    void freshUrl(message.id, { url: file.url, expiresAt: file.url_expires_at }, (m) => m.file?.url)
      .then((url) => ctx.onOpenImage(url, file.filename, message.id))
      .catch(() => Alert.alert(t("chat.media_unavailable", { name: file.filename })));
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={t("chat.message_list.file_open_named", { name: file.filename || t("chat.media_image") })}
      onPress={open}
      onLongPress={onLongPress}
      delayLongPress={200}
      className="overflow-hidden bg-muted"
      style={[{ width, height }, corners]}
    >
      {src ? <Image source={{ uri: src }} contentFit="cover" style={{ width, height }} /> : null}
      {more > 0 ? (
        <View className="absolute inset-0 items-center justify-center bg-black/45">
          <Text className="text-xl font-display font-bold text-on-solid">+{more}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function AlbumGrid({ photos, ctx, onLongPress }: { photos: readonly TimelineMessage[]; ctx: MessageCardContext; onLongPress: () => void }) {
  const { t } = useTranslation();
  const shown = photos.slice(0, VISIBLE);
  const more = photos.length - shown.length;
  const half = (GRID_WIDTH - GAP) / 2;
  const lead = shown.length % 2 === 1 ? shown[0] : null;
  const pairs = lead ? shown.slice(1) : shown;
  const rowHeight = lead ? 86 : shown.length > 2 ? 110 : 132;
  return (
    <View accessibilityLabel={t("chat.album_aria", { count: photos.length })} style={{ width: GRID_WIDTH, gap: GAP }}>
      {lead ? (
        <Tile message={lead} ctx={ctx} width={GRID_WIDTH} height={132} more={0} corners={{ borderTopLeftRadius: 15, borderTopRightRadius: 15, borderRadius: 4 }} onLongPress={onLongPress} />
      ) : null}
      <View className="flex-row flex-wrap" style={{ gap: GAP }}>
        {pairs.map((photo, index) => {
          const top = !lead && index < 2;
          return (
            <Tile
              key={photo.id}
              message={photo}
              ctx={ctx}
              width={half}
              height={rowHeight}
              more={index === pairs.length - 1 ? more : 0}
              corners={{ borderRadius: 4, ...(top ? (index === 0 ? { borderTopLeftRadius: 15 } : { borderTopRightRadius: 15 }) : {}) }}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
}

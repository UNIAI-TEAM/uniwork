// An album bubble's photos (canvas MobileChat): a 2-column grid inside a 3 pt
// frame; with an odd count the first photo spans the row, the rest go in
// pairs; past four the last tile says how many more. A tap opens that photo in
// the viewer, which pages through the conversation's photos. Each tile is a
// button a screen reader reaches, with the message menu as an action (audit
// U3); the first one says it starts an album of N photos, the last one how
// many more it hides.
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { TimelineMessage } from "@/lib/timeline-display";
import type { MessageCardContext } from "./message-cards";
import { useChatMediaSrc, useFreshChatMediaUrl } from "./use-chat-media";
import { toast } from "@/data/stores/toast-store";
import { chatMediaSource, IMAGE_CACHE_POLICY } from "@/lib/media-source";

const GRID_WIDTH = 262;
const GAP = 3;
const VISIBLE = 4;

interface TileProps {
  message: TimelineMessage;
  ctx: MessageCardContext;
  width: number;
  height: number;
  more: number;
  corners: object;
  /** Said before the tile's own label: "Album of 5 photos" on the first tile. */
  lead?: string;
  onLongPress: () => void;
}

function Tile({ message, ctx, width, height, more, corners, lead, onLongPress }: TileProps) {
  const { t } = useTranslation();
  const file = message.record!.file!;
  const src = useChatMediaSrc(ctx.wsId, ctx.roomId, message.id, file.thumb_url || file.url, file.url_expires_at);
  const freshUrl = useFreshChatMediaUrl(ctx.wsId, ctx.roomId);
  const open = () =>
    void freshUrl(message.id, { url: file.url, expiresAt: file.url_expires_at }, (m) => m.file?.url)
      .then((url) => ctx.onOpenImage(url, file.filename, message.id))
      .catch(() => toast.error(t("chat.media_unavailable", { name: file.filename })));
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={[lead, t("chat.message_list.file_open_named", { name: file.filename || t("chat.media_image") }), more > 0 ? t("chat.info_panel.more_photos", { count: more }) : null]
        .filter(Boolean)
        .join(", ")}
      accessibilityActions={[{ name: "longpress", label: t("chat.message_actions_aria") }]}
      onAccessibilityAction={onLongPress}
      onPress={open}
      onLongPress={onLongPress}
      delayLongPress={200}
      className="overflow-hidden bg-muted"
      style={[{ width, height }, corners]}
    >
      {src ? <Image source={chatMediaSource(src, message.id, "thumb")} cachePolicy={IMAGE_CACHE_POLICY} contentFit="cover" style={{ width, height }} /> : null}
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
  const albumLabel = t("chat.album_aria", { count: photos.length });
  return (
    <View style={{ width: GRID_WIDTH, gap: GAP }}>
      {lead ? (
        <Tile
          message={lead}
          ctx={ctx}
          width={GRID_WIDTH}
          height={132}
          more={0}
          corners={{ borderTopLeftRadius: 15, borderTopRightRadius: 15, borderRadius: 4 }}
          lead={albumLabel}
          onLongPress={onLongPress}
        />
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
              lead={!lead && index === 0 ? albumLabel : undefined}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
}

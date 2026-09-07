import { twemojiStickerUrl } from "./chat-expression-utils";
import type { ChatStickerItem, ChatStickerPack } from "./chat-expression-catalog";

type EmojiMartSkin = { native?: string };
type EmojiMartEmoji = {
  id: string;
  name: string;
  keywords?: string[];
  skins?: EmojiMartSkin[];
};
type EmojiMartCategory = { id: string; emojis: string[] };
type EmojiMartData = {
  categories: EmojiMartCategory[];
  emojis: Record<string, EmojiMartEmoji>;
};

const CATEGORY_LABELS: Record<string, string> = {
  people: "Cảm xúc",
  nature: "Thiên nhiên",
  foods: "Đồ ăn",
  activity: "Hoạt động",
  travel: "Du lịch",
  places: "Địa điểm",
  objects: "Đồ vật",
  symbols: "Biểu tượng",
  flags: "Cờ",
};

const MAX_STICKERS_PER_PACK = 80;
const SKIPPED_CATEGORIES = new Set(["component"]);

let cachedPacks: ChatStickerPack[] | null = null;
let loadPromise: Promise<ChatStickerPack[]> | null = null;

function toSticker(emojiId: string, emoji: EmojiMartEmoji | undefined): ChatStickerItem | null {
  const native = emoji?.skins?.[0]?.native?.trim();
  if (!native) return null;
  const label = emoji?.keywords?.[0]?.trim() || emoji?.name?.trim() || emojiId;
  return {
    id: emojiId,
    emoji: native,
    label,
    url: twemojiStickerUrl(native),
  };
}

export async function loadChatStickerPacks(): Promise<ChatStickerPack[]> {
  if (cachedPacks) return cachedPacks;
  if (loadPromise) return loadPromise;

  loadPromise = import("@emoji-mart/data")
    .then((mod) => {
      const data = (mod.default ?? mod) as EmojiMartData;
      const packs = data.categories
        .filter((category) => !SKIPPED_CATEGORIES.has(category.id))
        .map((category) => {
          const stickers = category.emojis
            .slice(0, MAX_STICKERS_PER_PACK)
            .map((emojiId) => toSticker(emojiId, data.emojis[emojiId]))
            .filter((sticker): sticker is ChatStickerItem => sticker !== null);
          return {
            id: category.id,
            name: CATEGORY_LABELS[category.id] ?? category.id,
            stickers,
          };
        })
        .filter((pack) => pack.stickers.length > 0);
      cachedPacks = packs;
      return packs;
    })
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

export function filterStickerPacks(
  packs: ChatStickerPack[],
  query: string,
): ChatStickerPack[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return packs;
  return packs
    .map((pack) => ({
      ...pack,
      stickers: pack.stickers.filter(
        (sticker) =>
          sticker.label.toLowerCase().includes(normalized) ||
          sticker.emoji.includes(normalized) ||
          pack.name.toLowerCase().includes(normalized),
      ),
    }))
    .filter((pack) => pack.stickers.length > 0);
}

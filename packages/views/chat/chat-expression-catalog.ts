export type ChatStickerItem = {
  id: string;
  emoji: string;
  label: string;
  url: string;
};

export type ChatStickerPack = {
  id: string;
  name: string;
  coverUrl?: string;
  stickers: ChatStickerItem[];
};

export type ChatGifItem = {
  id: string;
  label: string;
  url: string;
  previewUrl: string;
};

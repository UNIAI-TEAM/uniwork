import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatStickerPack } from "./chat-expression-catalog";
import { filterStickerPacks } from "./chat-sticker-packs";

type FakeEmoji = {
  id: string;
  name?: string;
  keywords?: string[];
  skins?: { native?: string }[];
};

type FakeData = {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, FakeEmoji>;
};

type EmojiMartMock = {
  default: unknown;
  categories: unknown;
  emojis: unknown;
};

const mocked = vi.hoisted<EmojiMartMock>(() => ({
  default: undefined,
  categories: undefined,
  emojis: undefined,
}));

vi.mock("@emoji-mart/data", () => mocked);

function makePacks(): ChatStickerPack[] {
  return [
    {
      id: "people",
      name: "Cảm xúc",
      stickers: [
        { id: "grin", emoji: "😀", label: "Grinning face", url: "https://cdn.example/grin.png" },
        { id: "joy", emoji: "😂", label: "Joy tears", url: "https://cdn.example/joy.png" },
      ],
    },
    {
      id: "nature",
      name: "Thiên nhiên",
      stickers: [
        { id: "tree", emoji: "🌳", label: "Green tree", url: "https://cdn.example/tree.png" },
      ],
    },
  ];
}

function baseDataset(): FakeData {
  return {
    categories: [
      {
        id: "people",
        emojis: ["grinning", "no_skins", "empty_skins", "blank_native", "no_native", "ghost"],
      },
      { id: "component", emojis: ["component_emoji"] },
      {
        id: "custom",
        emojis: ["keyword_emoji", "name_emoji", "fallback_emoji", "blank_keyword", "noname_emoji"],
      },
      { id: "empty", emojis: ["ghost"] },
    ],
    emojis: {
      grinning: {
        id: "grinning",
        name: "Grinning Face",
        keywords: ["grin", "smile"],
        skins: [{ native: "😀" }],
      },
      no_skins: { id: "no_skins", name: "No Skins" },
      empty_skins: { id: "empty_skins", name: "Empty Skins", skins: [] },
      blank_native: {
        id: "blank_native",
        name: "Blank",
        keywords: ["blank"],
        skins: [{ native: "   " }],
      },
      no_native: { id: "no_native", name: "No Native", skins: [{}] },
      component_emoji: {
        id: "component_emoji",
        name: "Component",
        keywords: ["component"],
        skins: [{ native: "©️" }],
      },
      keyword_emoji: {
        id: "keyword_emoji",
        name: "Keyword Name",
        keywords: ["happy"],
        skins: [{ native: "😄" }],
      },
      name_emoji: {
        id: "name_emoji",
        name: "Smiley Name",
        skins: [{ native: "😁" }],
      },
      fallback_emoji: {
        id: "fallback_emoji",
        name: "   ",
        skins: [{ native: "😂" }],
      },
      blank_keyword: {
        id: "blank_keyword",
        name: "Blank Keyword",
        keywords: ["   "],
        skins: [{ native: "😆" }],
      },
      noname_emoji: { id: "noname_emoji", skins: [{ native: "😅" }] },
    },
  };
}

describe("filterStickerPacks", () => {
  it("returns the same packs reference for empty or blank queries", () => {
    const packs = makePacks();
    expect(filterStickerPacks(packs, "")).toBe(packs);
    expect(filterStickerPacks(packs, "   ")).toBe(packs);
  });

  it("matches stickers by label case-insensitively", () => {
    const packs = makePacks();
    const result = filterStickerPacks(packs, "  GRIN ");
    expect(result.map((pack) => pack.id)).toEqual(["people"]);
    expect(result[0]?.stickers.map((sticker) => sticker.id)).toEqual(["grin"]);
  });

  it("matches stickers by emoji", () => {
    const packs = makePacks();
    const result = filterStickerPacks(packs, "🌳");
    expect(result.map((pack) => pack.id)).toEqual(["nature"]);
    expect(result[0]?.stickers.map((sticker) => sticker.id)).toEqual(["tree"]);
  });

  it("keeps every sticker of a pack whose name matches", () => {
    const packs = makePacks();
    const result = filterStickerPacks(packs, "CẢM");
    expect(result.map((pack) => pack.id)).toEqual(["people"]);
    expect(result[0]?.stickers).toHaveLength(2);
  });

  it("drops packs with zero matching stickers entirely", () => {
    const packs = makePacks();
    expect(filterStickerPacks(packs, "no-such-sticker")).toEqual([]);
    const partial = filterStickerPacks(packs, "tree");
    expect(partial.map((pack) => pack.id)).toEqual(["nature"]);
  });
});

describe("loadChatStickerPacks", () => {
  beforeEach(() => {
    mocked.default = undefined;
    mocked.categories = undefined;
    mocked.emojis = undefined;
    vi.resetModules();
  });

  it("builds packs with skip logic, label fallbacks, and empty-pack filtering", async () => {
    mocked.default = baseDataset();
    const mod = await import("./chat-sticker-packs");
    const packs = await mod.loadChatStickerPacks();

    expect(packs.map((pack) => pack.id)).toEqual(["people", "custom"]);
    const people = packs.find((pack) => pack.id === "people");
    expect(people?.name).toBe("Cảm xúc");
    expect(people?.stickers.map((sticker) => sticker.id)).toEqual(["grinning"]);
    expect(people?.stickers.map((sticker) => sticker.label)).toEqual(["grin"]);
    expect(people?.stickers.map((sticker) => sticker.emoji)).toEqual(["😀"]);
    expect(people?.stickers.every((sticker) => sticker.url.endsWith(".png"))).toBe(true);

    const custom = packs.find((pack) => pack.id === "custom");
    expect(custom?.name).toBe("custom");
    expect(custom?.stickers.map((sticker) => sticker.label)).toEqual([
      "happy",
      "Smiley Name",
      "fallback_emoji",
      "Blank Keyword",
      "noname_emoji",
    ]);
  });

  it("supports bare module payloads without a default export", async () => {
    const dataset = baseDataset();
    mocked.default = undefined;
    mocked.categories = dataset.categories;
    mocked.emojis = dataset.emojis;
    const mod = await import("./chat-sticker-packs");
    const packs = await mod.loadChatStickerPacks();
    expect(packs.map((pack) => pack.id)).toEqual(["people", "custom"]);
  });

  it("caps stickers per pack at 80", async () => {
    const ids = Array.from({ length: 85 }, (_, index) => `e${index}`);
    const emojis: Record<string, FakeEmoji> = {};
    for (const id of ids) {
      emojis[id] = { id, name: `Emoji ${id}`, skins: [{ native: "😀" }] };
    }
    mocked.default = { categories: [{ id: "people", emojis: ids }], emojis };
    const mod = await import("./chat-sticker-packs");
    const packs = await mod.loadChatStickerPacks();
    expect(packs.map((pack) => pack.id)).toEqual(["people"]);
    expect(packs[0]?.stickers).toHaveLength(80);
    expect(packs[0]?.stickers.map((sticker) => sticker.id)).toEqual(ids.slice(0, 80));
  });

  it("shares one in-flight load and caches the resolved packs", async () => {
    mocked.default = baseDataset();
    const mod = await import("./chat-sticker-packs");
    const [first, second] = await Promise.all([
      mod.loadChatStickerPacks(),
      mod.loadChatStickerPacks(),
    ]);
    expect(second).toBe(first);
    await expect(mod.loadChatStickerPacks()).resolves.toBe(first);
  });

  it("clears in-flight state after a failed import so the next call retries", async () => {
    mocked.default = null;
    const mod = await import("./chat-sticker-packs");
    await expect(mod.loadChatStickerPacks()).rejects.toThrow();

    mocked.default = baseDataset();
    const packs = await mod.loadChatStickerPacks();
    expect(packs.map((pack) => pack.id)).toEqual(["people", "custom"]);
  });
});

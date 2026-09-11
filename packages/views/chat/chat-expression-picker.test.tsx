import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatExpressionPicker } from "./chat-expression-picker";

vi.mock("@uniwork/core/chat", () => ({
  useChatGifs: () => ({
    data: [{ id: "gif1", label: "ok", url: "https://media.giphy.com/media/1.gif", previewUrl: "https://media.giphy.com/media/1.gif" }],
    isFetching: false,
  }),
  useChatStickers: () => ({
    data: [{ id: "st1", label: "vui", url: "https://media.tenor.com/sticker.webp", previewUrl: "https://media.tenor.com/sticker-tiny.webp" }],
    isFetching: false,
  }),
}));

vi.mock("./chat-sticker-packs", () => ({
  loadChatStickerPacks: vi.fn().mockResolvedValue([
    {
      id: "feelings",
      name: "Cảm xúc",
      stickers: [
        {
          id: "smile",
          emoji: "😀",
          label: "cười",
          url: "https://cdn.example/1f600.png",
        },
      ],
    },
  ]),
  filterStickerPacks: (packs: unknown[]) => packs,
}));

vi.mock("@uniwork/ui/components/common/emoji-picker", () => ({
  EmojiPicker: ({ onSelect }: { onSelect: (emoji: string) => void }) => (
    <button type="button" onClick={() => onSelect("🎉")}>
      Pick emoji
    </button>
  ),
}));

beforeAll(() => {
  initI18n();
});

describe("ChatExpressionPicker", () => {
  it("opens sticker tab and sends sticker media on click", async () => {
    const onSendMedia = vi.fn();
    render(
      wrap(
        <ChatExpressionPicker
          workspaceId="ws1"
          onSelectEmoji={vi.fn()}
          onSendMedia={onSendMedia}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sticker, emoji và GIF" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "vui" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "vui" }));
    expect(onSendMedia).toHaveBeenCalledWith(
      expect.stringMatching(/^!\[sticker:vui\]\(https:\/\/media\.tenor\.com\/sticker\.webp\)$/),
    );
  });

  it("switches emoji sticker pack from footer", async () => {
    const onSendMedia = vi.fn();
    render(
      wrap(
        <ChatExpressionPicker
          workspaceId="ws1"
          onSelectEmoji={vi.fn()}
          onSendMedia={onSendMedia}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sticker, emoji và GIF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cảm xúc" }));
    fireEvent.click(screen.getByRole("button", { name: "cười" }));
    expect(onSendMedia).toHaveBeenCalledWith(
      expect.stringMatching(/^!\[sticker:cười\]\(https:\/\/.+\.png\)$/),
    );
  });

  it("switches to gif tab and sends gif media", async () => {
    const onSendMedia = vi.fn();
    render(
      wrap(
        <ChatExpressionPicker
          workspaceId="ws1"
          onSelectEmoji={vi.fn()}
          onSendMedia={onSendMedia}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Sticker, emoji và GIF" }));
    fireEvent.click(screen.getByRole("tab", { name: "GIF" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "ok" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    expect(onSendMedia).toHaveBeenCalledWith(expect.stringContaining("giphy.com"));
  });
});

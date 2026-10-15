import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatComposer } from "./chat-composer";

initI18n();

vi.mock("@uniwork/core/chat", () => ({
  useChatGifs: () => ({ data: [], isFetching: false }),
  useChatStickers: () => ({ data: [], isFetching: false }),
}));

vi.mock("./chat-sticker-packs", () => ({
  loadChatStickerPacks: vi.fn().mockResolvedValue([]),
  filterStickerPacks: (packs: unknown[]) => packs,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));
describe("ChatComposer mentions", () => {
  it("opens mention picker on @ and inserts a member token", async () => {
    const onDraftChange = vi.fn();

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={onDraftChange}
          onSend={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
          mentionCandidates={[
            { kind: "member", userId: "u2", label: "Binh", email: "binh@example.com" },
          ]}
        />,
      ),
    );
    const input = screen.getByLabelText("Nhập tin nhắn…");
    fireEvent.change(input, { target: { value: "@", selectionStart: 1 } });
    expect(await screen.findByRole("listbox", { name: "Nhắc ai đó" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Binh/i })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("option", { name: /Binh/i }));
    expect(onDraftChange).toHaveBeenCalledWith("@Binh ");
  });

  it("normalizes pasted markdown mention tokens to @ labels", () => {
    const onDraftChange = vi.fn();

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={onDraftChange}
          onSend={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );
    const input = screen.getByLabelText("Nhập tin nhắn…");
    fireEvent.change(input, {
      target: {
        value: "[@tran hoang long](mention://member/u1)",
        selectionStart: 44,
      },
    });
    expect(onDraftChange).toHaveBeenCalledWith("@tran hoang long");
  });

  it("counts the serialized mention tokens against the limit", () => {
    const onSend = vi.fn();
    // 3,960 visible characters fit, but each @label is sent as a ~45-character
    // [@label](mention://member/<id>) token, which puts the body over 4,000.
    const draft = `${"a".repeat(3950)} @Binh @An`;

    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft={draft}
          onDraftChange={vi.fn()}
          onSend={onSend}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
          mentionCandidates={[
            { kind: "member", userId: "01J9Z8Y7X6W5V4T3S2R1Q0P9N8", label: "Binh", email: "binh@example.com" },
            { kind: "member", userId: "01J9Z8Y7X6W5V4T3S2R1Q0P9N9", label: "An", email: "an@example.com" },
          ]}
        />,
      ),
    );
    expect(screen.getByText("Còn 0 ký tự")).toHaveClass("text-destructive");
    fireEvent.keyDown(screen.getByLabelText("Nhập tin nhắn…"), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});

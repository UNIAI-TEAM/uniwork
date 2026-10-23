import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatComposer } from "./chat-composer";
import type { ChatMentionCandidate } from "./chat-mention-utils";

initI18n();

vi.mock("@uniwork/core/chat", () => ({
  useChatGifs: () => ({ data: [], isFetching: false }),
  useChatStickers: () => ({ data: [], isFetching: false }),
}));

vi.mock("./chat-sticker-packs", () => ({
  loadChatStickerPacks: vi.fn().mockResolvedValue([]),
  filterStickerPacks: (packs: unknown[]) => packs,
}));

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const CANDIDATES: ChatMentionCandidate[] = [
  { kind: "member", userId: "u2", label: "Binh", email: "binh@example.com" },
  { kind: "member", userId: "u3", label: "Chi", email: "chi@example.com" },
  { kind: "member", userId: "u4", label: "Dung", email: "dung@example.com" },
];

function StatefulComposer({ onSend = vi.fn() }: { onSend?: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <ChatComposer
      workspaceId="ws1"
      draft={draft}
      onDraftChange={setDraft}
      onSend={onSend}
      placeholder="Nhập tin nhắn…"
      sendLabel="Gửi"
      mentionCandidates={CANDIDATES}
    />
  );
}

describe("ChatComposer keyboard", () => {
  it("moves through mentions with the arrows and picks the active one with Enter", async () => {
    const user = userEvent.setup();
    render(wrap(<StatefulComposer />));
    const input = screen.getByRole("combobox", { name: "Nhập tin nhắn…" });

    await user.type(input, "@");
    expect(await screen.findByRole("listbox", { name: "Nhắc ai đó" })).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");

    // The list is @all, Binh, Chi, Dung: two steps down lands on Chi.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /Chi/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");

    expect(input).toHaveValue("@Chi ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the picker on Escape and keeps it closed until the query changes", async () => {
    const user = userEvent.setup();
    render(wrap(<StatefulComposer />));
    const input = screen.getByRole("combobox", { name: "Nhập tin nhắn…" });

    await user.type(input, "@b");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Moving the caret or clicking does not bring it back for the same query…
    await user.keyboard("{ArrowLeft}{ArrowRight}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // …typing more does.
    await user.type(input, "i");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Binh/ })).toBeInTheDocument();
  });

  it("keeps focus in the field after sending", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(wrap(<StatefulComposer onSend={onSend} />));
    const input = screen.getByRole("combobox", { name: "Nhập tin nhắn…" });
    await user.type(input, "xin chào");
    await user.click(screen.getByRole("button", { name: "Gửi" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(input).toHaveFocus());
  });
});

describe("ChatComposer voice errors", () => {
  function renderComposer() {
    render(
      wrap(
        <ChatComposer
          workspaceId="ws1"
          draft=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onSendVoice={vi.fn()}
          placeholder="Nhập tin nhắn…"
          sendLabel="Gửi"
        />,
      ),
    );
  }

  it("names a refused microphone and offers no send", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
    });
    vi.stubGlobal("MediaRecorder", class {
      static isTypeSupported = () => true;
    });
    renderComposer();
    await user.click(screen.getByRole("button", { name: "Ghi âm tin nhắn thoại" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt chưa cho dùng micro");
    expect(screen.queryByRole("button", { name: "Gửi" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Đóng" })).toHaveFocus());
    vi.unstubAllGlobals();
  });

  it("says when the browser cannot record at all", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    renderComposer();
    await user.click(screen.getByRole("button", { name: "Ghi âm tin nhắn thoại" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Trình duyệt này không ghi âm được");
  });
});

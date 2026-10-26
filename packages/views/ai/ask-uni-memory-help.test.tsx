import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMemoryHelp } from "./ask-uni-memory-help";

initI18n();
const entry = (id: string, kind: string) => ({ id, kind, text: id, source: "user", created_at: "", updated_at: "" });
const answer = (entries: ReturnType<typeof entry>[]) => ({ entries, on: true, limit: 50, remaining: 50 - entries.length });
const mount = () => render(wrapWithNav(<AskUniMemoryHelp orgSlug="acme" />));

beforeEach(() => {
  requestMock.mockReset();
  useAiPanelStore.setState({ view: "thread", memoryHelp: true, composerPrefill: null });
});

describe("AskUniMemoryHelp", () => {
  it("says what UNI remembers and fills the composer from a starter, sending nothing", async () => {
    requestMock.mockResolvedValue(answer([entry("a", "preference"), entry("b", "preference"), entry("c", "fact")]));
    mount();
    expect(await screen.findByText("UNI đang nhớ 3 điều: 2 về cách trả lời, 1 về bạn.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Gợi ý sửa bộ nhớ" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đổi cách xưng hô" }));
    expect(useAiPanelStore.getState().composerPrefill).toBe("Từ giờ gọi tôi là ");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ một mục" }));
    expect(useAiPanelStore.getState().composerPrefill).toBe("Bỏ khỏi bộ nhớ mục ");
    expect(requestMock).toHaveBeenCalledTimes(1); // the memory list only
  });

  it("offers no forget starter on an empty memory, and closes", async () => {
    requestMock.mockResolvedValue(answer([]));
    mount();
    expect(await screen.findByText(/UNI chưa nhớ gì về bạn/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bỏ một mục" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Đóng gợi ý" }));
    expect(useAiPanelStore.getState().memoryHelp).toBe(false);
  });
});

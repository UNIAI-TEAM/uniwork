import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMemoryUsed } from "./ask-uni-memory-used";

initI18n();
const entry = (id: string, text: string) => ({ id, kind: "fact", text, source: "user", created_at: "", updated_at: "" });
const mount = (ids: string[]) => render(wrapWithNav(<AskUniMemoryUsed memoryIds={ids} orgSlug="acme" />));

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({ entries: [entry("m1", "Trả lời ngắn gọn"), entry("m2", "Tôi là kế toán")], on: true, limit: 50, remaining: 48 });
  useAiPanelStore.setState({ view: "thread" });
});

describe("AskUniMemoryUsed", () => {
  it("names the first entry, counts the rest and opens the memory screen from the list", async () => {
    mount(["m1", "m2"]);
    expect(await screen.findByText(/Đã dùng bộ nhớ: Trả lời ngắn gọn/)).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/acme/ai/memory");
    fireEvent.click(screen.getByRole("button", { name: /\+1/ }));
    fireEvent.click(await screen.findByText("Tôi là kế toán"));
    expect(useAiPanelStore.getState().view).toBe("memory");
  });

  it("opens the memory screen from a single used entry", async () => {
    mount(["m1"]);
    fireEvent.click(await screen.findByRole("button", { name: "Đã dùng bộ nhớ: Trả lời ngắn gọn" }));
    expect(useAiPanelStore.getState().view).toBe("memory");
  });

  it("says so when every used entry is deleted", async () => {
    mount(["gone"]);
    expect(await screen.findByText("Đã dùng bộ nhớ (mục đã xóa)")).toBeInTheDocument();
  });

  it("draws nothing for no ids", () => {
    const { container } = mount([]);
    expect(container).toBeEmptyDOMElement();
  });
});

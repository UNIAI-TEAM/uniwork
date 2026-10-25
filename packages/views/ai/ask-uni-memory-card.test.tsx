import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiKeys, useAiPanelStore } from "@uniwork/core/ai";
import { aiMemoryKeys } from "@uniwork/core/ai/memory";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { AiMemoryProposal, AiMessage } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMemoryCard } from "./ask-uni-memory-card";

initI18n();

const TEXT = "**đậm** <b>x</b> https://a.b";
const row = (over: Partial<AiMemoryProposal> = {}): AiMemoryProposal => ({
  id: "p1", message_id: "a1", position: 0, action: "remember", memory_id: "", kind: "fact", text: TEXT,
  before_kind: "", before_text: "", status: "pending", expires_at: "", ...over,
});
const message = (r: AiMemoryProposal): Pick<AiMessage, "id" | "memory_proposals"> => ({ id: "a1", memory_proposals: [r] });

function mount(r: AiMemoryProposal, tainted = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<AiMessage[]>(aiKeys.messages("c1"), [{ id: "a1", memory_proposals: [r] } as AiMessage]);
  // The memory list is keyed by the organization slug, as the memory screen reads it.
  client.setQueryData(aiMemoryKeys.all("acme"), { entries: [], on: true, limit: 50, remaining: 50 });
  const msgs = () => client.getQueryData<AiMessage[]>(aiKeys.messages("c1"))![0]!.memory_proposals;
  // The card renders what the cache holds, as the thread does.
  const Card = () => <AskUniMemoryCard message={{ id: "a1", memory_proposals: msgs() }} conversationId="c1" orgSlug="acme" tainted={tainted} />;
  const view = render(wrapWithNav(<Card />, undefined, client));
  return { ...view, client, rerender: () => view.rerender(wrapWithNav(<Card />, undefined, client)) };
}

beforeEach(() => {
  requestMock.mockReset();
  useAiPanelStore.setState({ view: "thread" });
});

describe("AskUniMemoryCard", () => {
  it("shows a remember proposal as plain text and applies it", async () => {
    requestMock.mockResolvedValue(row({ status: "applied" }));
    const { container, rerender, client } = mount(row());
    expect(screen.getByRole("region", { name: "Đề xuất bộ nhớ" })).toBeInTheDocument();
    expect(screen.getByText("Nhớ điều này?")).toBeInTheDocument();
    expect(container.textContent).toContain(TEXT);
    expect(container.querySelector("strong, b, a")).toBeNull();
    expect(screen.getByText("Về bạn")).toBeInTheDocument();
    for (const n of ["Nhớ", "Sửa", "Bỏ qua"]) expect(screen.getByRole("button", { name: n })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nhớ" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/memory-proposals/p1/apply", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(client.getQueryState(aiMemoryKeys.all("acme"))?.isInvalidated).toBe(true));
    await waitFor(() => rerender());
    expect(await screen.findByText("Đã nhớ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hoàn tác" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở Bộ nhớ" }));
    expect(useAiPanelStore.getState().view).toBe("memory");
  });

  it("shows old text then new for an update", () => {
    mount(row({ action: "update", before_text: "Tôi là kế toán", text: "Tôi là trưởng phòng" }));
    expect(screen.getByText("Sửa mục trong bộ nhớ?")).toBeInTheDocument();
    expect(screen.getByText("Tôi là kế toán")).toBeInTheDocument();
    expect(screen.getByText("Tôi là trưởng phòng")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu" })).toBeInTheDocument();
  });

  it("asks to forget an entry", () => {
    mount(row({ action: "forget", text: "Tôi là kế toán" }));
    expect(screen.getByText("Quên mục này?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quên" })).toBeInTheDocument();
  });

  it("edits the text before saving with PATCH", async () => {
    requestMock.mockResolvedValue(row({ text: "Mới" }));
    mount(row());
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    fireEvent.change(screen.getByLabelText("Chữ sẽ lưu"), { target: { value: "Mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/memory-proposals/p1", expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ text: "Mới" }) })),
    );
  });

  it("counts runes when editing: 300 emoji save, 301 are refused before any call", async () => {
    requestMock.mockResolvedValue(row({ text: "😀".repeat(300) }));
    mount(row());
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    fireEvent.change(screen.getByLabelText("Chữ sẽ lưu"), { target: { value: "😀".repeat(301) } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Mục không hợp lệ. Mỗi mục là một dòng, 1–300 ký tự.");
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Chữ sẽ lưu"), { target: { value: "😀".repeat(300) } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/memory-proposals/p1", expect.objectContaining({ body: expect.objectContaining({ text: "😀".repeat(300) }) })),
    );
  });

  it("says the entry changed since UNI proposed it and keeps the buttons", async () => {
    const pending = row({ action: "update", before_text: "Tôi là kế toán", text: "Tôi là trưởng phòng" });
    requestMock.mockRejectedValue(new ApiError("changed", "ai_memory_changed", 409, undefined, { proposal: pending }));
    mount(pending);
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Mục này đã đổi từ khi UNI đề xuất. Mở Bộ nhớ để xem.");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeInTheDocument();
  });

  it("gives a deleted proposal its own copy, not the generic one", async () => {
    requestMock.mockRejectedValue(new ApiError("gone", "not_found", 404));
    mount(row());
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không còn tìm thấy mục này.");
  });

  it("has no buttons once expired", () => {
    mount(row({ status: "expired" }));
    expect(screen.getByText("Đề xuất đã hết hạn")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("warns when the conversation is tainted", () => {
    mount(row(), true);
    expect(screen.getByText(/UNI đã đọc nội dung người khác viết/)).toBeInTheDocument();
  });

  it("paints the row a 409 carries", async () => {
    requestMock.mockRejectedValue(new ApiError("conflict", "proposal_not_pending", 409, undefined, { proposal: row({ status: "applied" }) }));
    const { rerender } = mount(row());
    fireEvent.click(screen.getByRole("button", { name: "Nhớ" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    await waitFor(() => rerender());
    expect(await screen.findByText("Đã nhớ")).toBeInTheDocument();
  });
});

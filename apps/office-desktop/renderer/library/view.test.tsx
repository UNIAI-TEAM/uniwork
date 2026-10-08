/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesktopLibraryDocument } from "../../shared/ipc";
import { LibraryView } from "./view";

const row: DesktopLibraryDocument = {
  id: "doc-1",
  workspaceId: "ws",
  title: "Plan.docx",
  kind: "file",
  format: "docx",
  version: 1,
  revision: "1",
  updatedAt: "2026-09-30T00:00:00.000Z",
  ownerKind: null,
  canEdit: true,
  downloadAvailable: true,
};

it("renders client-side DOCX open/download actions when the server engine is unavailable", () => {
  const onOpen = vi.fn();
  const onDownload = vi.fn();
  render(<LibraryView mode="list" documents={[row]} engineAvailable={false} onOpen={onOpen} onDownload={onDownload} />);
  expect(screen.queryByText("Trình soạn thảo không khả dụng")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  expect(onOpen).toHaveBeenCalledWith(row);
  fireEvent.click(screen.getByRole("button", { name: "Tải xuống" }));
  expect(onDownload).toHaveBeenCalledWith(row);
});

it("renders an empty state and fires mode changes", async () => {
  const onModeChange = vi.fn();
  const onCreate = vi.fn();
  const onOpenLocal = vi.fn();
  render(<LibraryView mode="recent" documents={[]} engineAvailable={false} onModeChange={onModeChange} onCreate={onCreate} onOpenLocal={onOpenLocal} />);
  expect(screen.queryByText("Tr\u00ecnh so\u1ea1n th\u1ea3o kh\u00f4ng kh\u1ea3 d\u1ee5ng")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tài liệu mới" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Markdown/ }));
  fireEvent.click(screen.getByRole("button", { name: "Mở tệp trên máy" }));
  expect(onCreate).toHaveBeenCalledExactlyOnceWith("md");
  expect(onOpenLocal).toHaveBeenCalledOnce();
  expect(screen.getByText("Chưa có tài liệu")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
  expect(onModeChange).toHaveBeenCalledWith("list");
});

it("shows search-specific copy when a submitted query matches nothing", () => {
  render(<LibraryView mode="search" searchQuery="zzz-no-such-doc" documents={[]} engineAvailable />);
  expect(screen.getByText("Không tìm thấy kết quả")).toBeInTheDocument();
  expect(screen.getByText("Không có tài liệu nào khớp từ khóa tìm kiếm.")).toBeInTheDocument();
  expect(screen.queryByText("Chưa có tài liệu")).not.toBeInTheDocument();
});

it("preserves the typed query and submits it on search", () => {
  const onSearch = vi.fn();
  const { container } = render(<LibraryView mode="search" searchQuery="roadmap" documents={[]} engineAvailable onSearch={onSearch} />);
  const input = screen.getByRole("searchbox", { name: "Tìm kiếm" });
  expect(input).toHaveValue("roadmap");
  fireEvent.change(input, { target: { value: "notes" } });
  fireEvent.click(container.querySelector("button[type=submit]")!);
  expect(onSearch).toHaveBeenCalledWith("notes");
});

it("announces the collection count alongside its title and header actions", () => {
  render(<LibraryView mode="list" documents={[row]} engineAvailable />);
  expect(screen.getByRole("heading", { level: 1, name: "Tài liệu" })).toBeInTheDocument();
  expect(screen.getByText("1 tài liệu")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tài liệu mới" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mở tệp trên máy" })).toBeInTheDocument();
});

it("tells the member why cloud documents cannot be opened while the server engine is down", () => {
  const { rerender } = render(<LibraryView mode="list" documents={[row]} engineAvailable={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("Hiện chưa mở được tài liệu trên đám mây");
  rerender(<LibraryView mode="list" documents={[row]} engineAvailable />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

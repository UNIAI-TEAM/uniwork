import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  EditorChrome,
  type EditorChromeCommandGroup,
  type EditorChromeCommandItem,
  type EditorChromeProps,
  type EditorChromeStatusItems,
  type EditorChromeTab,
  type EditorChromeViewMode,
} from "./index";

initI18n();

const MARKDOWN_VIEWS: EditorChromeViewMode[] = [
  { id: "source", label: "Mã nguồn" },
  { id: "split", label: "Chia đôi" },
  { id: "preview", label: "Xem trước" },
];

function tabs(): EditorChromeTab[] {
  return [
    {
      id: "home",
      label: "Trang chủ",
      groups: [
        { id: "history", label: "Lịch sử", items: [{ id: "undo", label: "Hoàn tác", onSelect: vi.fn() }] },
        { id: "inline", label: "Định dạng", items: [{ id: "bold", label: "In đậm", pressed: true, onSelect: vi.fn() }] },
      ],
    },
    { id: "insert", label: "Chèn", groups: [{ id: "blocks", label: "Khối", items: [{ id: "table", label: "Bảng", onSelect: vi.fn() }] }] },
  ];
}

/** jsdom lays nothing out: report the widths the overflow decision is written against. */
function stubWidths(widths: Record<string, number>, rowWidth: number): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const group = this.getAttribute("data-chrome-group");
    const width = group ? widths[group] : undefined;
    if (width !== undefined) {
      return { x: 0, y: 0, width, height: 28, top: 0, left: 0, right: width, bottom: 28, toJSON: () => ({}) } as DOMRect;
    }
    if (this.getAttribute("data-testid") === "editor-chrome-commands") {
      return { x: 0, y: 0, width: rowWidth, height: 44, top: 0, left: 0, right: rowWidth, bottom: 44, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

describe("EditorChrome", () => {
  it("hợp đồng props: một tab đủ nhóm, control tự vẽ, chế độ xem và thanh trạng thái", () => {
    const custom: EditorChromeCommandItem = {
      id: "style",
      label: "Kiểu đoạn",
      // Một control do nơi gọi dựng (select, split button) được giữ nguyên.
      render: <button type="button">Heading 1</button>,
    };
    const group: EditorChromeCommandGroup = {
      id: "styles",
      label: "Kiểu",
      items: [custom, { id: "clear", label: "Xoá định dạng", disabled: true, onSelect: vi.fn() }],
    };
    const status: EditorChromeStatusItems = {
      left: <span>Trang 1/3 · 245 từ</span>,
      right: <span>Đang chọn 12 ký tự · 100%</span>,
    };
    const props: EditorChromeProps = {
      tabs: [{ id: "home", label: "Trang chủ", groups: [group] } as EditorChromeTab],
      viewModes: MARKDOWN_VIEWS,
      activeViewMode: "split",
      status,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onFind: vi.fn(),
    };
    render(<EditorChrome {...props} />);
    // `render` được dùng nguyên trạng: nơi gọi giữ tên truy cập của control riêng.
    expect(screen.getByRole("button", { name: "Heading 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xoá định dạng" })).toBeDisabled();
    expect(screen.getByTestId("editor-chrome-status")).toHaveTextContent("Trang 1/3 · 245 từ");
    expect(screen.getByTestId("editor-chrome-status")).toHaveTextContent("Đang chọn 12 ký tự · 100%");
    // Không có văn bản chọn/đếm nào trong hàng tab hay hàng lệnh (C6).
    expect(screen.getByTestId("editor-chrome-tabs")).not.toHaveTextContent("Đang chọn");
    expect(screen.getByTestId("editor-chrome-commands")).not.toHaveTextContent("Đang chọn");
  });

  it("chỉ dựng hàng nào có nội dung (không hàng rỗng)", () => {
    const { rerender } = render(<EditorChrome />);
    expect(screen.queryByTestId("editor-chrome-tabs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-chrome-commands")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-chrome-status")).not.toBeInTheDocument();

    rerender(<EditorChrome tabs={tabs()} />);
    expect(screen.getByTestId("editor-chrome-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("editor-chrome-commands")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-chrome-status")).not.toBeInTheDocument();

    rerender(<EditorChrome tabs={tabs()} status={{ left: <span>Trang 1/3</span> }} />);
    expect(screen.getByTestId("editor-chrome-status")).toHaveTextContent("Trang 1/3");
  });

  it("hàng lệnh vắng mặt khi tab đang mở không có lệnh nào", () => {
    render(
      <EditorChrome
        tabs={[{ id: "empty", label: "Trống", groups: [] }]}
        status={{ right: <span>100%</span> }}
      />,
    );
    expect(screen.getByTestId("editor-chrome-tabs")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-chrome-commands")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-chrome-status")).toHaveTextContent("100%");
  });

  it("báo chế độ xem đang bật và đổi chế độ qua segmented control", () => {
    const onViewModeChange = vi.fn();
    render(<EditorChrome tabs={tabs()} viewModes={MARKDOWN_VIEWS} activeViewMode="source" onViewModeChange={onViewModeChange} />);
    const control = screen.getByTestId("editor-chrome-view");
    expect(within(control).getByRole("button", { name: "Mã nguồn" })).toHaveAttribute("aria-pressed", "true");
    expect(within(control).getByRole("button", { name: "Xem trước" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(control).getByRole("button", { name: "Xem trước" }));
    expect(onViewModeChange).toHaveBeenCalledWith("preview");
  });

  it("mỗi lệnh của tab chỉ xuất hiện một lần", () => {
    render(<EditorChrome tabs={tabs()} activeTabId="home" />);
    expect(screen.getAllByRole("button", { name: "Hoàn tác" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "In đậm" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Bảng" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In đậm" })).toHaveAttribute("aria-pressed", "true");
  });

  it("đặt quick-access ở đầu hàng tab, tìm và chế độ xem ở cuối, và gọi lại nơi gọi", () => {
    const onFind = vi.fn();
    render(
      <EditorChrome
        tabs={tabs()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onFind={onFind}
        viewModes={MARKDOWN_VIEWS}
        activeViewMode="source"
        onViewModeChange={vi.fn()}
      />,
    );
    const tabRow = screen.getByTestId("editor-chrome-tabs");
    const undo = within(tabRow).getByTestId("editor-chrome-undo");
    const tablist = within(tabRow).getByTestId("editor-chrome-tablist");
    const find = within(tabRow).getByTestId("editor-chrome-find");
    const view = within(tabRow).getByTestId("editor-chrome-view");
    // Undo/redo đứng trước danh sách tab; tìm và segmented control đứng sau.
    expect(undo.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablist.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(find.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(find);
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("điều hướng tab bằng phím mũi tên, Home và End", () => {
    const onTabChange = vi.fn();
    render(<EditorChrome tabs={tabs()} activeTabId="home" onTabChange={onTabChange} />);
    const home = screen.getByRole("tab", { name: "Trang chủ" });
    fireEvent.keyDown(home, { key: "ArrowRight" });
    expect(onTabChange).toHaveBeenLastCalledWith("insert");
    fireEvent.keyDown(home, { key: "Home" });
    expect(onTabChange).toHaveBeenLastCalledWith("home");
    fireEvent.keyDown(home, { key: "End" });
    expect(onTabChange).toHaveBeenLastCalledWith("insert");
    // Vòng qua trái từ tab đầu là tab cuối, không kẹt ở đầu danh sách.
    fireEvent.keyDown(home, { key: "ArrowLeft" });
    expect(onTabChange).toHaveBeenLastCalledWith("insert");
  });

  it("đẩy nguyên nhóm vào » khi hàng hẹp, không xuống dòng", async () => {
    const restore = stubWidths({ history: 300, inline: 300 }, 400);
    try {
      render(<EditorChrome tabs={tabs()} activeTabId="home" />);
      const row = screen.getByTestId("editor-chrome-commands");
      // Một hàng duy nhất: hàng không cho phép xuống dòng, nhóm thừa đi vào ».
      expect(row.className).toContain("overflow-hidden");
      expect(row.className).not.toContain("flex-wrap");
      fireEvent.click(within(row).getByTestId("editor-chrome-overflow"));
      // Nhóm "Định dạng" nằm nguyên trong menu, không còn là nút trên hàng.
      expect(await screen.findByRole("menuitem", { name: "In đậm" })).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "In đậm" })).not.toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Hoàn tác" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("không dựng » khi cả hàng vừa chỗ", () => {
    const restore = stubWidths({ history: 100, inline: 100 }, 900);
    try {
      render(<EditorChrome tabs={tabs()} activeTabId="home" />);
      expect(screen.queryByTestId("editor-chrome-overflow")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "In đậm" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("ở 390px hàng lệnh là một dải cuộn, nhóm dùng nhiều nhất đứng trước", () => {
    const original = window.innerWidth;
    window.innerWidth = 390;
    const restore = stubWidths({ history: 300, inline: 300 }, 200);
    try {
      render(<EditorChrome tabs={tabs()} activeTabId="home" />);
      const row = screen.getByTestId("editor-chrome-commands");
      expect(row.className).toContain("overflow-x-auto");
      expect(row.className).not.toContain("overflow-hidden");
      expect(screen.queryByTestId("editor-chrome-overflow")).not.toBeInTheDocument();
      expect(screen.getByTestId("editor-chrome")).toHaveAttribute("data-chrome-compact", "true");
      const labels = within(row)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));
      expect(labels).toEqual(["Hoàn tác", "In đậm"]);
    } finally {
      restore();
      window.innerWidth = original;
    }
  });
});

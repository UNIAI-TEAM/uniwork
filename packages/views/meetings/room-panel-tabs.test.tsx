import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoomPanelTabs, type RoomPanelBadge } from "./room-panel-tabs";
import { tablistKeyTarget } from "./tablist-keys";

type Tab = "uni" | "chat" | "people" | "votes";
const TABS: readonly Tab[] = ["uni", "chat", "people", "votes"];
const LABELS: Record<Tab, string> = { uni: "UNI", chat: "Trò chuyện", people: "Mọi người", votes: "Biểu quyết" };
const BADGES: Partial<Record<Tab, RoomPanelBadge>> = {
  chat: { tone: "info", count: 3, srLabel: "3 tin chưa đọc" },
  people: { tone: "attention", count: 12, srLabel: "12 người đang chờ vào" },
  votes: { tone: "attention", srLabel: "một biểu quyết đang chờ bạn" },
};

function renderTabs(props: { value?: Tab; onChange?: (tab: Tab) => void; end?: React.ReactNode; fill?: boolean } = {}) {
  return render(
    <RoomPanelTabs
      tabs={TABS}
      value={props.value ?? "uni"}
      onChange={props.onChange ?? (() => {})}
      label={(tab) => LABELS[tab]}
      icon={(tab) => <svg data-testid={`icon-${tab}`} />}
      badge={(tab) => BADGES[tab] ?? null}
      panelId={(tab) => `panel-${tab}`}
      ariaLabel="Bảng bên"
      end={props.end}
      fill={props.fill}
    />,
  );
}

describe("tablistKeyTarget", () => {
  it("wraps arrows at the ends, jumps with Home/End and ignores other keys", () => {
    expect(tablistKeyTarget("ArrowRight", 3, 4)).toBe(0);
    expect(tablistKeyTarget("ArrowRight", 1, 4)).toBe(2);
    expect(tablistKeyTarget("ArrowLeft", 0, 4)).toBe(3);
    expect(tablistKeyTarget("Home", 2, 4)).toBe(0);
    expect(tablistKeyTarget("End", 0, 4)).toBe(3);
    expect(tablistKeyTarget("Enter", 0, 4)).toBeNull();
  });
});

describe("RoomPanelTabs", () => {
  it("shows the label of the active tab only, while every tab keeps its name", () => {
    renderTabs();
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Bảng bên");
    expect(screen.getByText("UNI")).toBeVisible();
    // The others are icons, named by aria-label only.
    expect(screen.queryByText("Trò chuyện")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trò chuyện, 3 tin chưa đọc" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "UNI", selected: true })).toHaveAttribute("aria-controls", "panel-uni");
    expect(screen.getByRole("tab", { name: /^Mọi người/ })).not.toHaveAttribute("aria-controls");
  });

  it("wraps ArrowRight from the last tab to the first and selects it", () => {
    const onChange = vi.fn();
    renderTabs({ value: "votes", onChange });
    const first = screen.getByRole("tab", { name: "UNI" });
    fireEvent.keyDown(screen.getByRole("tab", { name: /^Biểu quyết/ }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("uni");
    expect(first).toHaveFocus();
  });

  it("only the active tab sits in the Tab order", () => {
    renderTabs({ value: "chat" });
    expect(screen.getByRole("tab", { name: /^Trò chuyện/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "UNI" })).toHaveAttribute("tabindex", "-1");
  });

  it("tones badges by meaning, caps the count and draws an uncounted badge as a dot", () => {
    renderTabs();
    const chat = screen.getByRole("tab", { name: /^Trò chuyện/ }).querySelector("[data-slot='tab-badge']");
    expect(chat).toHaveClass("bg-brand", "text-brand-foreground");
    expect(chat).toHaveTextContent("3");
    const people = screen.getByRole("tab", { name: /^Mọi người/ }).querySelector("[data-slot='tab-badge']");
    expect(people).toHaveClass("bg-badge-attention", "text-badge-attention-foreground");
    expect(people).toHaveTextContent("9+");
    const votes = screen.getByRole("tab", { name: /^Biểu quyết/ });
    expect(votes).toHaveAccessibleName("Biểu quyết, một biểu quyết đang chờ bạn");
    const dot = votes.querySelector("[data-slot='tab-badge']");
    expect(dot).toHaveClass("bg-badge-attention", "size-2");
    expect(dot).toBeEmptyDOMElement();
  });

  it("keeps every tab and the end slot a 44px touch target on coarse pointers", () => {
    renderTabs({ end: <button type="button">Thu gọn bảng</button> });
    for (const tab of screen.getAllByRole("tab")) expect(tab.className).toMatch(/pointer-coarse:h-11/);
  });

  it("renders the end slot in the same row, after the tablist", () => {
    renderTabs({ end: <button type="button">Thu gọn bảng</button> });
    const end = screen.getByRole("button", { name: "Thu gọn bảng" });
    const tablist = screen.getByRole("tablist");
    expect(tablist.parentElement).toContainElement(end);
    expect(tablist.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("RoomPanelTabs fill", () => {
  it("spreads the track over the row on the sheet, the pill taking the larger share", () => {
    const { unmount } = renderTabs();
    expect(screen.getByRole("tablist")).not.toHaveClass("flex-1");
    unmount();
    renderTabs({ fill: true });
    expect(screen.getByRole("tablist")).toHaveClass("flex-1");
    expect(screen.getByRole("tab", { name: "UNI" })).toHaveClass("flex-[1.5]");
    expect(screen.getByRole("tab", { name: /^Trò chuyện/ })).toHaveClass("flex-1", "w-auto");
  });
});

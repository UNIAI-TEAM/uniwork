import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../../test/api-mock";
import { PageFirstUseHint, PAGE_HINT_STORAGE_KEY } from "./page-first-use-hint";
import { helpSections, PageHelpPopover } from "./page-help-popover";

const { t } = initI18n();
const k = (key: string) => t(`documents.page_ui.toolbar.${key}`);

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: vi.fn((key: string) => data[key] ?? null), setItem: vi.fn((key: string, value: string) => { data[key] = value; }) };
}

describe("PageFirstUseHint", () => {
  it("shows the tip once and stays dismissed after Đã hiểu", () => {
    const storage = memory();
    const { unmount } = render(wrap(<PageFirstUseHint onShowShortcuts={vi.fn()} storage={storage} />));
    const tip = screen.getByRole("region", { name: k("hint.aria") });
    expect(within(tip).getByRole("heading", { name: k("hint.title") })).toBeInTheDocument();
    expect(tip).toHaveTextContent("/");
    expect(tip).toHaveTextContent("@");
    fireEvent.click(within(tip).getByRole("button", { name: k("hint.got_it") }));
    expect(screen.queryByRole("region", { name: k("hint.aria") })).not.toBeInTheDocument();
    expect(storage.data[PAGE_HINT_STORAGE_KEY]).toBe("1");
    unmount();
    render(wrap(<PageFirstUseHint onShowShortcuts={vi.fn()} storage={storage} />));
    expect(screen.queryByRole("region", { name: k("hint.aria") })).not.toBeInTheDocument();
  });

  it("the close button dismisses it for good too", () => {
    const storage = memory();
    render(wrap(<PageFirstUseHint onShowShortcuts={vi.fn()} storage={storage} />));
    fireEvent.click(screen.getByRole("button", { name: k("hint.close") }));
    expect(storage.data[PAGE_HINT_STORAGE_KEY]).toBe("1");
  });

  it("Xem phím tắt opens the shortcuts without dismissing the tip", () => {
    const onShowShortcuts = vi.fn();
    const storage = memory();
    render(wrap(<PageFirstUseHint onShowShortcuts={onShowShortcuts} storage={storage} />));
    fireEvent.click(screen.getByRole("button", { name: k("hint.show_shortcuts") }));
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("still works when storage throws", () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error("denied"); }),
      setItem: vi.fn(() => { throw new Error("denied"); }),
    };
    render(wrap(<PageFirstUseHint onShowShortcuts={vi.fn()} storage={storage} />));
    fireEvent.click(screen.getByRole("button", { name: k("hint.got_it") }));
    expect(screen.queryByRole("region", { name: k("hint.aria") })).not.toBeInTheDocument();
  });
});

describe("PageHelpPopover", () => {
  it("lists the three groups of shortcuts and the Mac note", () => {
    render(wrap(<PageHelpPopover open onOpenChange={vi.fn()} tabIndex={0} onFocus={vi.fn()} />));
    const dialog = screen.getByRole("dialog", { name: k("help.title") });
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((node) => node.textContent))
      .toEqual([k("help.quick"), k("help.line"), k("help.keys")]);
    for (const section of helpSections(t)) {
      for (const row of section.rows) expect(within(dialog).getByText(row.what)).toBeInTheDocument();
    }
    for (const typed of ["/", "@", "#", "##", "###", "-", "1.", "[ ]", ">", "```", "---"]) {
      expect(within(dialog).getAllByText(typed).length).toBeGreaterThan(0);
    }
    expect(dialog).toHaveTextContent(k("help.note"));
  });

  it("never advertises Ctrl+K, which is the app search", () => {
    render(wrap(<PageHelpPopover open onOpenChange={vi.fn()} tabIndex={0} onFocus={vi.fn()} />));
    expect(screen.getByRole("dialog", { name: k("help.title") }).querySelector('[data-shortcut-key="K"], [aria-label$="+K"]')).toBeNull();
  });

  it("closes from its own button", () => {
    const onOpenChange = vi.fn();
    render(wrap(<PageHelpPopover open onOpenChange={onOpenChange} tabIndex={0} onFocus={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: k("help.close") }));
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });
});

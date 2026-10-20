import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { configureShortcutPlatform, formatShortcut } from "@uniwork/core/shortcuts";
import { pageShortcutChords } from "../../editor/extensions/page-shortcuts";
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

  it("reports the dismissal so focus can return to the page", () => {
    const onDismissed = vi.fn();
    render(wrap(<PageFirstUseHint onShowShortcuts={vi.fn()} onDismissed={onDismissed} storage={memory()} />));
    fireEvent.click(screen.getByRole("button", { name: k("hint.got_it") }));
    expect(onDismissed).toHaveBeenCalledTimes(1);
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
  afterEach(() => configureShortcutPlatform(null));

  it("lists the groups of shortcuts and the Mac note", () => {
    render(wrap(<PageHelpPopover open onOpenChange={vi.fn()} tabIndex={0} onFocus={vi.fn()} />));
    const dialog = screen.getByRole("dialog", { name: k("help.title") });
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((node) => node.textContent))
      .toEqual([k("help.quick"), k("help.line"), k("help.keys"), k("help.blocks")]);
    for (const section of helpSections(t)) {
      for (const row of section.rows) expect(within(dialog).getAllByText(row.what).length).toBeGreaterThan(0);
    }
    for (const typed of ["/", "@", "#", "##", "###", "-", "1.", "[ ]", ">", "```", "---"]) {
      expect(within(dialog).getAllByText(typed).length).toBeGreaterThan(0);
    }
    expect(dialog).toHaveTextContent(k("help.note"));
  });

  it("keeps the note to the typed patterns: the chords print per platform, so it never says to swap Ctrl for ⌘", () => {
    render(wrap(<PageHelpPopover open onOpenChange={vi.fn()} tabIndex={0} onFocus={vi.fn()} />));
    expect(k("help.note")).not.toMatch(/⌘|Mac/);
    expect(k("help.note")).toContain("---");
  });

  it.each(["windows", "macos"] as const)("%s: lists every key of the page shortcut table, Word's key first", (platform) => {
    configureShortcutPlatform(platform);
    render(wrap(<PageHelpPopover open onOpenChange={vi.fn()} tabIndex={0} onFocus={vi.fn()} />));
    const dialog = screen.getByRole("dialog", { name: k("help.title") });
    const shown = (id: string, platformId: "windows" | "macos") => pageShortcutChords(id as never, platformId).map((chord) => formatShortcut(chord, platformId));
    const blocks = within(dialog).getByRole("region", { name: k("help.blocks") });
    const rowKeys = (what: string, scope: HTMLElement = dialog) =>
      within(within(scope).getByText(what).parentElement!).getAllByRole("img").map((node) => node.getAttribute("aria-label"));
    expect(rowKeys(k("help.keys_save"))).toEqual(shown("save", platform));
    expect(rowKeys(k("help.keys_redo"))).toEqual(shown("redo", platform));
    expect(rowKeys(k("help.keys_link"))).toEqual(shown("link", platform));
    expect(rowKeys(k("help.keys_strike"))).toEqual(shown("strike", platform));
    expect(rowKeys(k("help.keys_bullet"), blocks)).toEqual(shown("bulletList", platform));
    expect(rowKeys(k("help.keys_format"))).toEqual(["bold", "italic", "underline"].map((id) => shown(id, platform)[0]));
    if (platform === "windows") expect(rowKeys(k("help.keys_clear"))).toEqual(["Ctrl+Space"]);
    // Control+Space switches the input source on macOS: no clear-formatting key, so no row.
    else expect(within(dialog).queryByText(k("help.keys_clear"))).not.toBeInTheDocument();
    expect(shown("link", "windows")).toEqual(["Ctrl+K"]);
  });

  it("closes from its own button", () => {
    const onOpenChange = vi.fn();
    render(wrap(<PageHelpPopover open onOpenChange={onOpenChange} tabIndex={0} onFocus={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: k("help.close") }));
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });
});

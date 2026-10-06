// @vitest-environment jsdom
// UNI-952 fix-G-ctrlp F2 - the menu entry and Ctrl/Cmd+P share one printing state.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import { OfficePrintShortcutScope } from "../../print/shortcut";
import { MarkdownPrintMenuItems, MarkdownPrintShortcut } from "./print-menu";
import type { MarkdownPrintOutcome, MarkdownPrintPort } from "./print";

const { t } = initI18n();

beforeEach(async () => {
  await setLocale("en");
});

/** A port whose run stays in flight until the test settles it. */
function pendingPort() {
  const settle: ((outcome: MarkdownPrintOutcome) => void)[] = [];
  const print = vi.fn(() => new Promise<MarkdownPrintOutcome>((resolve) => { settle.push(resolve); }));
  const port: MarkdownPrintPort = { print };
  return { port, print, settle };
}

function Page({ port }: { port: MarkdownPrintPort }) {
  const ref = useRef<HTMLDivElement>(null);
  const props = { port, renderHtml: () => "<p>x</p>", title: "x" };
  return (
    <div ref={ref}>
      <OfficePrintShortcutScope rootRef={ref}>
        <DropdownMenu open>
          <DropdownMenuContent>
            <MarkdownPrintMenuItems {...props} />
          </DropdownMenuContent>
        </DropdownMenu>
        <MarkdownPrintShortcut {...props} />
      </OfficePrintShortcutScope>
    </div>
  );
}

const menuPrint = () => screen.getByRole("menuitem", { name: t("office.common.print") });

describe("Markdown print: menu entry and Ctrl/Cmd+P", () => {
  it("ignores Ctrl+P while a run started from the menu is still in flight", async () => {
    const { port, print, settle } = pendingPort();
    render(<Page port={port} />);
    fireEvent.click(menuPrint());
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // Still blocks the app window's native print, but starts no second run.
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(print).toHaveBeenCalledTimes(1);
    await act(async () => { settle[0]!({ outcome: "printed" }); });
    expect(fireEvent.keyDown(document.body, { key: "p", ctrlKey: true })).toBe(false);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
  });

  it("ignores the menu click while a run started from Ctrl+P is still in flight", async () => {
    const { port, print, settle } = pendingPort();
    render(<Page port={port} />);
    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(menuPrint()).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(menuPrint());
    await act(async () => { await Promise.resolve(); });
    expect(print).toHaveBeenCalledTimes(1);
    await act(async () => { settle[0]!({ outcome: "printed" }); });
    await waitFor(() => expect(menuPrint()).not.toHaveAttribute("aria-busy"));
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateMenu, QuickCreateRow } from "./documents-home-create";

const { t } = initI18n();

/** The menu's entries in DOM order: "-" for a separator, else the accessible name. */
function menuOrder(): string[] {
  const menu = screen.getByRole("menu");
  return [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="separator"]')].map((el) =>
    el.getAttribute("role") === "separator" ? "-" : (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
  );
}

describe("New menu order (UNI-1994 nit: the share switch belongs to documents, not to Folder)", () => {
  it("puts Folder first and the share switch after the document kinds, a separator on each side", async () => {
    render(
      wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={vi.fn()} onNewFolder={vi.fn()} />),
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    await screen.findByRole("menuitemcheckbox");

    const order = menuOrder();
    const folder = order.findIndex((name) => name.startsWith(t("documents.home.create.folder.menu")));
    const toggle = order.indexOf(t("documents.home.create.share_workspace_toggle"));
    const pdf = order.findIndex((name) => name.startsWith(t("documents.home.create.pdf.menu")));

    expect(folder).toBe(0);
    expect(order[folder + 1]).toBe("-");
    // The last document kind, one separator, then the switch: nothing else sits between.
    expect(toggle).toBe(pdf + 2);
    expect(order[pdf + 1]).toBe("-");
    // Every document kind lies between Folder and the switch.
    const kinds = ["page", "docx", "xlsx", "pptx", "md", "txt", "html", "pdf"].map((type) =>
      order.findIndex((name) => name.startsWith(t(`documents.home.create.${type}.menu`))),
    );
    for (const index of kinds) {
      expect(index).toBeGreaterThan(folder);
      expect(index).toBeLessThan(toggle);
    }
  });
});

describe("New menu: plain text entry (UNI-2046)", () => {
  it.each([
    ["vi", "Văn bản"],
    ["en", "Plain text"],
  ] as const)("puts the %s entry right under Markdown, with the .txt hint", async (locale, label) => {
    await setLocale(locale);
    try {
      render(wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={vi.fn()} />));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
      await screen.findByRole("menuitemcheckbox");

      const order = menuOrder();
      const md = order.findIndex((name) => name.startsWith(t("documents.home.create.md.menu")));
      expect(md).toBeGreaterThanOrEqual(0);
      expect(order[md + 1]).toBe(`${label}.txt`);
      expect(t("documents.home.create.txt.menu")).toBe(label);
      expect(t("documents.home.create.txt.ext")).toBe(".txt");
    } finally {
      await setLocale("vi");
    }
  });

  it("creates the entry as format txt", async () => {
    const onCreate = vi.fn();
    render(wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={onCreate} onUpload={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.txt.menu")) }));
    expect(onCreate).toHaveBeenCalledWith("txt", { shareWithWorkspace: false });
  });
});

describe("Quick create strip: no plain text (UNI-2046, user 2026-10-21 \"không cần quick create txt\")", () => {
  it("offers no txt chip while the New menu keeps its entry right under Markdown", async () => {
    render(wrap(<QuickCreateRow pending={false} unavailable={new Set()} onCreate={vi.fn()} />));
    const chips = screen.getAllByRole("button").map((b) => (b.textContent ?? "").trim());
    expect(chips).toEqual(
      ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"].map((type) => t(`documents.home.create.${type}.chip`)),
    );
    expect(screen.queryByTitle(".txt")).toBeNull();
    expect(t("documents.home.create.txt.chip")).toBe("documents.home.create.txt.chip");
  });
});

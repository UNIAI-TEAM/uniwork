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

describe("New menu order (UNI-1994 nit, UNI-2038 Q2: the share switch is gone)", () => {
  it("puts Folder first, a separator, then the document kinds with no share switch after them", async () => {
    render(
      wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={vi.fn()} onNewFolder={vi.fn()} />),
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.pdf.menu")) });

    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
    const order = menuOrder();
    const folder = order.findIndex((name) => name.startsWith(t("documents.home.create.folder.menu")));
    expect(folder).toBe(0);
    expect(order[folder + 1]).toBe("-");
    expect(order).not.toContain(t("documents.home.create.share_workspace_toggle"));
    const kinds = ["page", "docx", "xlsx", "pptx", "md", "txt", "html", "pdf"].map((type) =>
      order.findIndex((name) => name.startsWith(t(`documents.home.create.${type}.menu`))),
    );
    for (const index of kinds) expect(index).toBeGreaterThan(folder);
    // Nothing follows the last document kind but the narrow-screen Upload entry.
    const last = Math.max(...kinds);
    expect(order.slice(last + 1).filter((name) => name !== "-")).toEqual([t("documents.home.create.upload.button")]);
  });
});

describe("New menu: plain text entry (UNI-2046)", () => {
  it.each([
    ["vi", "Văn bản thuần"],
    ["en", "Plain text"],
  ] as const)("puts the %s entry right under Markdown, with the .txt hint", async (locale, label) => {
    await setLocale(locale);
    try {
      render(wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={vi.fn()} />));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
      await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.pdf.menu")) });

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
    expect(onCreate).toHaveBeenCalledWith("txt");
  });
});

describe("Quick create strip (UNI-2047 N-05: UniNote and Office only, user 2026-10-21)", () => {
  const stripChips = () => screen.getAllByRole("button").map((b) => (b.textContent ?? "").trim());
  const chips = (...types: string[]) => types.map((type) => t(`documents.home.create.${type}.chip`));

  it("offers UniNote, DOCX, XLSX and PPTX; Markdown, HTML, PDF and plain text live only in the New menu", async () => {
    render(wrap(<QuickCreateRow pending={false} unavailable={new Set()} onCreate={vi.fn()} />));
    expect(stripChips()).toEqual(chips("page", "docx", "xlsx", "pptx"));
    expect(screen.queryByTitle(".txt")).toBeNull();
    expect(t("documents.home.create.txt.chip")).toBe("documents.home.create.txt.chip");
  });

  it.each(["md", "html", "pdf"] as const)("adds one %s pill after the four when it was created last", (recent) => {
    const onCreate = vi.fn();
    render(wrap(<QuickCreateRow pending={false} unavailable={new Set()} onCreate={onCreate} recentType={recent} />));
    expect(stripChips()).toEqual(chips("page", "docx", "xlsx", "pptx", recent));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t(`documents.home.create.${recent}.chip`)) }));
    expect(onCreate).toHaveBeenCalledWith(recent);
  });

  it.each(["page", "docx", "xlsx", "pptx", "txt", null, undefined] as const)(
    "adds no pill when the last type is %s",
    (recent) => {
      render(wrap(<QuickCreateRow pending={false} unavailable={new Set()} onCreate={vi.fn()} recentType={recent} />));
      expect(stripChips()).toEqual(chips("page", "docx", "xlsx", "pptx"));
    },
  );

  it("greys the extra pill like the others when the server cannot create that type", () => {
    render(wrap(<QuickCreateRow pending={false} unavailable={new Set(["pdf"] as const)} onCreate={vi.fn()} recentType="pdf" />));
    expect(screen.getByRole("button", { name: new RegExp(t("documents.home.create.pdf.chip")) })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

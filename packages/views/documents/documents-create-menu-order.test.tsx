import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateMenu } from "./documents-home-create";

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
    const kinds = ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"].map((type) =>
      order.findIndex((name) => name.startsWith(t(`documents.home.create.${type}.menu`))),
    );
    for (const index of kinds) {
      expect(index).toBeGreaterThan(folder);
      expect(index).toBeLessThan(toggle);
    }
  });
});

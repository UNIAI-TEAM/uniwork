import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateCards, CreateMenu, type CreateChoicesProps } from "./documents-home-create";

// DOC2-W01 / DOC2-W02: the one-tap "Restricted" switch on the create surfaces.

const { t } = initI18n();

// Read lazily: the locale only switches once a provider has rendered.
const toggleName = () => t("documents.home.create.restricted_toggle");

function props(over: Partial<CreateChoicesProps> = {}): CreateChoicesProps {
  return {
    pending: false,
    unavailable: new Set(),
    onCreate: vi.fn(),
    onUpload: vi.fn(),
    onNewFolder: vi.fn(),
    filesRestrictable: true,
    parentRestricted: false,
    ...over,
  };
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: t("documents.home.create.menu") }));
  return screen.findByRole("menuitemcheckbox", { name: new RegExp(toggleName()) });
}

describe("CreateMenu restricted switch (DOC2-W01)", () => {
  it("is a menuitemcheckbox, off by default, that stays open when toggled", async () => {
    render(wrap(<CreateMenu {...props()} />));
    const toggle = await openMenu();
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    // The menu is still open: the document types are still on screen.
    expect(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.page.menu")) })).toBeInTheDocument();
    expect(toggle).toHaveClass("pointer-coarse:min-h-11");
  });

  it("sends restricted for every type and the folder once it is on, and nothing when it is off", async () => {
    const onCreate = vi.fn();
    const onNewFolder = vi.fn();
    render(wrap(<CreateMenu {...props({ onCreate, onNewFolder })} />));
    const toggle = await openMenu();

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.docx.menu")) }));
    expect(onCreate).toHaveBeenLastCalledWith("docx", true);

    const second = await openMenu();
    // Reopening the menu starts from "off" again (the signed default is workspace).
    expect(second).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.page.menu")) }));
    expect(onCreate).toHaveBeenLastCalledWith("page", false);

    const third = await openMenu();
    fireEvent.click(third);
    await waitFor(() => expect(third).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.folder.menu")) }));
    expect(onNewFolder).toHaveBeenLastCalledWith(true);
  });

  it("blocks the file types, not the page or folder, when the server cannot restrict files", async () => {
    const onCreate = vi.fn();
    render(wrap(<CreateMenu {...props({ onCreate, filesRestrictable: false })} />));
    fireEvent.click(await openMenu());

    const docx = await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.docx.menu")) });
    await waitFor(() => expect(docx).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(docx);
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.page.menu")) }));
    expect(onCreate).toHaveBeenCalledWith("page", true);
  });
});

describe("CreateCards restricted switch (DOC2-W01)", () => {
  it("is a button with aria-pressed, off by default, and sends restricted once pressed", () => {
    const onCreate = vi.fn();
    render(wrap(<CreateCards {...props({ onCreate })} />));
    const toggle = screen.getByRole("button", { name: new RegExp(toggleName()) });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveClass("pointer-coarse:min-h-11");

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.docx.card")) }));
    expect(onCreate).toHaveBeenLastCalledWith("docx", false);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.page.card")) }));
    expect(onCreate).toHaveBeenLastCalledWith("page", true);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.xlsx.card")) }));
    expect(onCreate).toHaveBeenLastCalledWith("xlsx", true);
  });

  it("keeps the file cards off while restricted is on and the server cannot restrict files", () => {
    const onCreate = vi.fn();
    render(wrap(<CreateCards {...props({ onCreate, filesRestrictable: false })} />));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(toggleName()) }));

    const docx = screen.getByRole("button", { name: new RegExp(t("documents.home.create.docx.card")) });
    expect(docx).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(docx);
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.page.card")) }));
    expect(onCreate).toHaveBeenCalledWith("page", true);
  });
});

describe("restricted parent (DOC2-W02)", () => {
  it("shows the switch on and locked with the inherited hint, and sends no field (cards)", () => {
    const onCreate = vi.fn();
    render(wrap(<CreateCards {...props({ onCreate, parentRestricted: true, filesRestrictable: false })} />));
    const toggle = screen.getByRole("button", { name: new RegExp(toggleName()) });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled();
    const hintId = toggle.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId!)).toHaveTextContent(t("documents.home.create.restricted_inherited"));

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Inherited, so files are fine even without the capability, and nothing is sent.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.docx.card")) }));
    expect(onCreate).toHaveBeenCalledWith("docx", false);
  });

  it("locks the menu item too and still sends no field", async () => {
    const onCreate = vi.fn();
    render(wrap(<CreateMenu {...props({ onCreate, parentRestricted: true })} />));
    const toggle = await openMenu();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    const hintId = toggle.getAttribute("aria-describedby");
    expect(within(document.body).getByText(t("documents.home.create.restricted_inherited"))).toBeInTheDocument();
    expect(hintId).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(t("documents.home.create.page.menu")) }));
    expect(onCreate).toHaveBeenCalledWith("page", false);
  });
});

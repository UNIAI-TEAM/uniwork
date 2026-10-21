import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateMenu } from "./documents-home-create";

const { t } = initI18n();

function renderMenu(over: { onUploadFolder?: () => void } = {}) {
  const onUpload = vi.fn();
  const ui = (extra: { onUploadFolder?: () => void }) =>
    wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={onUpload} {...extra} />);
  const view = render(ui(over));
  return { onUpload, rerenderWith: (extra: { onUploadFolder?: () => void }) => view.rerender(ui(extra)) };
}

describe("Upload entries with folder upload (UNI-2052)", () => {
  it("keeps the toolbar Upload acting as a plain button, and the New menu free of folder items, without onUploadFolder", async () => {
    const user = userEvent.setup();
    const { onUpload } = renderMenu();
    const upload = screen.getAllByRole("button", { name: t("documents.home.create.upload.button") })[0] as HTMLElement;
    expect(upload).not.toHaveAttribute("aria-haspopup");
    await user.click(upload);
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: t("documents.folder_upload.menu_folder") })).toBeNull();
  });

  it("is the same toolbar element, with focus kept, before and after the config makes folder upload available (RF15)", async () => {
    const onUploadFolder = vi.fn();
    const { onUpload, rerenderWith } = renderMenu();
    const before = screen.getAllByRole("button", { name: t("documents.home.create.upload.button") })[0] as HTMLElement;
    before.focus();
    expect(before).toHaveFocus();

    rerenderWith({ onUploadFolder });
    const after = screen.getByRole("button", { name: t("documents.folder_upload.menu_label") });
    expect(after).toBe(before);
    expect(after).toHaveFocus();
    expect(after).toHaveAttribute("aria-haspopup", "menu");
    // Now it opens the files / folder menu instead of uploading at once.
    fireEvent.click(after);
    await screen.findByRole("menuitem", { name: t("documents.folder_upload.menu_folder") });
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("turns the toolbar Upload into a menu of files and folder", async () => {
    const onUploadFolder = vi.fn();
    const { onUpload } = renderMenu({ onUploadFolder });
    const trigger = screen.getByRole("button", { name: t("documents.folder_upload.menu_label") });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger);
    expect(onUpload).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.folder_upload.menu_file") }));
    expect(onUpload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: t("documents.folder_upload.menu_label") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.folder_upload.menu_folder") }));
    expect(onUploadFolder).toHaveBeenCalledTimes(1);
  });

  it("adds Tải lên thư mục to the New menu beside the narrow-screen Tải lên", async () => {
    const onUploadFolder = vi.fn();
    renderMenu({ onUploadFolder });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    const items = (await screen.findAllByRole("menuitem")).map((el) => el.textContent?.trim());
    const upload = items.indexOf(t("documents.home.create.upload.button"));
    expect(upload).toBeGreaterThan(-1);
    expect(items[upload + 1]).toBe(t("documents.folder_upload.menu_folder"));
    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.folder_upload.menu_folder") }));
    expect(onUploadFolder).toHaveBeenCalledTimes(1);
  });
});

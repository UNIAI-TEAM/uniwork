import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateMenu } from "./documents-home-create";

const { t } = initI18n();

function renderMenu(over: { onUploadFolder?: () => void } = {}) {
  const onUpload = vi.fn();
  render(wrap(<CreateMenu pending={false} unavailable={new Set()} onCreate={vi.fn()} onUpload={onUpload} {...over} />));
  return { onUpload };
}

describe("Upload entries with folder upload (UNI-2052)", () => {
  it("keeps the toolbar Upload a plain button and the New menu free of folder items without onUploadFolder", async () => {
    const { onUpload } = renderMenu();
    fireEvent.click(screen.getAllByRole("button", { name: t("documents.home.create.upload.button") })[0] as HTMLElement);
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: t("documents.folder_upload.menu_folder") })).toBeNull();
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

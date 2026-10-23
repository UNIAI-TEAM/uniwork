import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentLockLostDialog } from "./conflict-dialog";
import { downloadPageCopy, lostCopyKey } from "./edit-lock-copy";

// UNI-1645 (addendum §9, §11.4): the lost-lock dialog, the `locked` variant of the conflict dialog.

function renderDialog(reason: string | null, byName = "An") {
  const onDownload = vi.fn();
  const onReload = vi.fn();
  render(<DocumentLockLostDialog open onOpenChange={vi.fn()} reason={reason} byName={byName} onDownload={onDownload} onReload={onReload} />);
  return { onDownload, onReload };
}

afterEach(() => vi.restoreAllMocks());

describe("DocumentLockLostDialog", () => {
  it.each([
    ["taken_over", "An đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây."],
    ["handed_over", "Bạn đã nhường quyền sửa cho An. Thay đổi chưa lưu của bạn vẫn ở đây."],
    ["moved_here", "Bạn đang sửa tài liệu này ở cửa sổ khác. Thay đổi chưa lưu ở cửa sổ này vẫn ở đây."],
    ["expired", "Quyền sửa đã hết hạn vì một lúc lâu không liên lạc được với máy chủ (mất mạng hoặc máy ngủ). Thay đổi chưa lưu của bạn vẫn ở đây."],
    ["access_lost", "Bạn không còn quyền sửa tài liệu này. Thay đổi chưa lưu của bạn vẫn ở đây."],
  ])("says why for %s", async (reason, text) => {
    renderDialog(reason);
    const dialog = await screen.findByRole("alertdialog", { name: "Bạn không còn quyền sửa" });
    expect(dialog).toHaveTextContent(text);
  });

  it.each([["document_archived"], ["something_new"], [null]])("reads %s generic", async (reason) => {
    renderDialog(reason as string | null);
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Bạn không còn giữ quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.");
    expect(lostCopyKey(reason as string | null)).toBe("documents.editLock.lostGeneric");
  });

  it("offers only the copy and the reload, never keep-mine or overwrite, with focus on the download", async () => {
    renderDialog("taken_over");
    await screen.findByRole("alertdialog");
    await waitFor(() => expect(screen.getByRole("button", { name: "Tải bản của tôi" })).toHaveFocus());
    expect(screen.queryByText("Giữ bản của tôi")).toBeNull();
    expect(screen.queryByRole("button", { name: /ghi đè/i })).toBeNull();
  });

  it("reloads only after confirming the unsaved changes are dropped", async () => {
    const { onReload, onDownload } = renderDialog("expired");
    fireEvent.click(await screen.findByRole("button", { name: "Tải lại bản mới nhất" }));
    expect(onReload).not.toHaveBeenCalled();
    expect(await screen.findByText("Tải lại sẽ bỏ thay đổi chưa lưu trên trang này. Tiếp tục?")).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "Tải lại bản mới nhất" }).at(-1)!;
    fireEvent.click(confirm);
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("downloads the unsaved page as '{title} (bản của tôi).html' with the live HTML in a full document", async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:copy"; }), revokeObjectURL: vi.fn() });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    const name = downloadPageCopy("<p>chưa lưu</p>", "Kế hoạch: Q4", "Kế hoạch: Q4 (bản của tôi)");
    expect(name).toBe("Kế hoạch Q4 (bản của tôi).html");
    expect(clicked[0]?.download).toBe("Kế hoạch Q4 (bản của tôi).html");
    expect(blobs[0]?.type).toBe("text/html");
    // jsdom's Blob has no text(): read it the way a browser without it would.
    const html = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]!); });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Kế hoạch: Q4</title>");
    expect(html).toContain("<p>chưa lưu</p>");
  });
});

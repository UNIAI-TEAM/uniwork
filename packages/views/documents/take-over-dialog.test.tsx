import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import type { DocumentEditLockSummary } from "@uniwork/core/api/endpoints/documents-edit-lock";
import { TakeOverDialog, type TakeOverDialogProps } from "./take-over-dialog";

// UNI-1645 (addendum §11.3, contract C2-1): a manager takes over the tenure the dialog showed.

const summary = (over: Partial<DocumentEditLockSummary> = {}): DocumentEditLockSummary => ({
  lock_id: "L1", holder_id: "u2", holder_name: "An", since: "2026-10-15T03:12:00Z", expires_at: "2026-10-15T03:14:00Z",
  reserved: false, held_by_me: false, ...over,
});

function setup(over: Partial<TakeOverDialogProps> = {}) {
  const props: TakeOverDialogProps = {
    open: true, onOpenChange: vi.fn(), lock: summary(), onConfirm: vi.fn(async () => undefined), onReread: vi.fn(), ...over,
  };
  const view = render(<TakeOverDialog {...props} />);
  return { props, rerender: (next: Partial<TakeOverDialogProps>) => view.rerender(<TakeOverDialog {...props} {...next} />) };
}

describe("TakeOverDialog", () => {
  it("is an alertdialog naming the holder, with focus on Cancel", async () => {
    setup();
    const dialog = await screen.findByRole("alertdialog", { name: "Lấy quyền sửa từ An?" });
    expect(dialog).toHaveTextContent("An sẽ chuyển sang chỉ đọc. Thay đổi chưa lưu của họ không bị xóa, họ vẫn tải về được.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Hủy" })).toHaveFocus());
  });

  it("takes over with the R1 lock id it showed, then closes", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Vẫn lấy quyền sửa" }));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
    expect(props.onConfirm).toHaveBeenCalledWith("L1");
  });

  it("keeps the shown id even when R1 changes under an open dialog (the server decides)", async () => {
    const { props, rerender } = setup();
    rerender({ lock: summary({ lock_id: "L2", holder_name: "Chi" }) });
    fireEvent.click(await screen.findByRole("button", { name: "Vẫn lấy quyền sửa" }));
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith("L1"));
  });

  it("409 edit_lock_changed: rereads, says so, names the new holder and takes over that tenure next", async () => {
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new ApiError("changed", "edit_lock_changed", 409))
      .mockResolvedValueOnce(undefined);
    const { props, rerender } = setup({ onConfirm });
    fireEvent.click(await screen.findByRole("button", { name: "Vẫn lấy quyền sửa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Người đang sửa vừa thay đổi. Xem lại rồi thử lại.");
    expect(props.onReread).toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    // Nothing to take over until the reread lands.
    expect(screen.getByRole("button", { name: "Vẫn lấy quyền sửa" })).toBeDisabled();
    await act(async () => rerender({ onConfirm, lock: summary({ lock_id: "L2", holder_name: "Chi" }) }));
    expect(screen.getByRole("alertdialog", { name: "Lấy quyền sửa từ Chi?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn lấy quyền sửa" }));
    await waitFor(() => expect(onConfirm).toHaveBeenLastCalledWith("L2"));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("any other failure says it failed and stays open", async () => {
    const { props } = setup({ onConfirm: vi.fn(async () => { throw new ApiError("boom", "internal", 500); }) });
    fireEvent.click(await screen.findByRole("button", { name: "Vẫn lấy quyền sửa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa lấy được quyền sửa. Thử lại.");
    expect(props.onReread).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("cannot take over without the lock id (an older server, or no holder)", async () => {
    setup({ lock: summary({ lock_id: undefined }) });
    expect(await screen.findByRole("button", { name: "Vẫn lấy quyền sửa" })).toBeDisabled();
  });
});

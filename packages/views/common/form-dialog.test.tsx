import { fireEvent, render, screen } from "@testing-library/react";
import { Ban } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { ConfirmDialog, FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "./form-dialog";

initI18n();

describe("FormDialog on a small screen", () => {
  it("keeps a margin around the dialog and stacks the leading slot with the buttons", () => {
    render(
      <Dialog open>
        <FormDialogContent>
          <FormDialogHeader title="Kết nối email" />
          <FormDialogBody>
            <p>Nội dung</p>
          </FormDialogBody>
          <FormDialogFooter leading={<button type="button">Quay lại</button>} onCancel={() => {}} />
        </FormDialogContent>
      </Dialog>,
    );

    // A body taller than the screen scrolls inside a dialog that stays 1rem clear of each edge.
    expect(screen.getByRole("dialog")).toHaveClass("flex", "flex-col", "max-h-[calc(100dvh-2rem)]");
    // Pushed aside only from sm up; below it, the stack centres it like Cancel instead of leaving it at the left.
    const leading = screen.getByRole("button", { name: "Quay lại" }).parentElement;
    expect(leading).toHaveClass("sm:mr-auto");
    expect(leading).not.toHaveClass("mr-auto");
  });
});

/*
 * A pressed action stays in the tab order: `disabled` would drop it, and the
 * focus with it, to <body> in the middle of a dialog, and a keyboard user
 * could never reach the button to hear why it cannot be pressed.
 * `aria-disabled` keeps it focusable and the Button primitive blocks the press.
 */
describe("FormDialogFooter while the action runs", () => {
  function footer(props: Partial<Parameters<typeof FormDialogFooter>[0]> = {}) {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <Dialog open>
        <FormDialogContent>
          <FormDialogHeader title="Đổi tên phòng" />
          <FormDialogFooter
            onCancel={onCancel}
            onSubmit={onSubmit}
            submitLabel="Lưu"
            submittingLabel="Đang lưu…"
            {...props}
          />
        </FormDialogContent>
      </Dialog>,
    );
    return { onCancel, onSubmit };
  }

  it("keeps both buttons focusable, busy and inert while submitting", () => {
    const { onCancel, onSubmit } = footer({ submitting: true });
    const submit = screen.getByRole("button", { name: "Đang lưu…" });
    const cancel = screen.getByRole("button", { name: "Hủy" });
    for (const button of [submit, cancel]) {
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
    expect(submit).toHaveAttribute("aria-busy", "true");
    // The decorative spinner is what a sighted reader sees change.
    expect(submit.querySelector('[data-slot="spinner"], svg')).not.toBeNull();
    fireEvent.click(submit);
    fireEvent.click(cancel);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("points a not-ready submit at the reason the leading slot gives", () => {
    footer({ submitDisabled: true, reasonId: "rename-reason", leading: <span id="rename-reason">Nhập tên mới</span> });
    const submit = screen.getByRole("button", { name: "Lưu" });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAccessibleDescription("Nhập tên mới");
    expect(submit).not.toHaveAttribute("aria-busy");
  });

  it("drops the reason once the submit is ready", () => {
    const { onSubmit } = footer({ reasonId: "rename-reason", leading: <span id="rename-reason">Nhập tên mới</span> });
    const submit = screen.getByRole("button", { name: "Lưu" });
    expect(submit).not.toHaveAttribute("aria-disabled");
    expect(submit).not.toHaveAttribute("aria-describedby");
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe("FormDialogContent scrim", () => {
  it("dims the page harder behind a destructive dialog", () => {
    const { unmount } = render(
      <Dialog open>
        <FormDialogContent>
          <FormDialogHeader title="Đổi tên" />
        </FormDialogContent>
      </Dialog>,
    );
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass("bg-black/10");
    unmount();
    render(
      <Dialog open>
        <FormDialogContent destructive>
          <FormDialogHeader title="Đóng tổ chức" />
        </FormDialogContent>
      </Dialog>,
    );
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toHaveClass("bg-black/45");
    expect(overlay).not.toHaveClass("bg-black/10");
  });
});

describe("ConfirmDialog while the action runs", () => {
  it("keeps both buttons focusable and inert, and the dialog open", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Xóa thành viên?"
        confirmLabel="Xóa"
        onConfirm={onConfirm}
        pending
      />,
    );
    const confirm = screen.getByRole("button", { name: "Xóa" });
    const cancel = screen.getByRole("button", { name: "Hủy" });
    for (const button of [confirm, cancel]) {
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-disabled", "true");
    }
    expect(confirm).toHaveAttribute("aria-busy", "true");
    fireEvent.click(confirm);
    fireEvent.click(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("ConfirmDialog optional look", () => {
  function confirm(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
    render(
      <ConfirmDialog open onOpenChange={() => {}} title="Chặn nhắn tin?" confirmLabel="Chặn" onConfirm={() => {}} {...props} />,
    );
    return {
      dialog: screen.getByRole("alertdialog"),
      confirmButton: screen.getByRole("button", { name: "Chặn" }),
      cancelButton: screen.getByRole("button", { name: "Hủy" }),
    };
  }

  it("renders as before when no new prop is given", () => {
    const { dialog, confirmButton, cancelButton } = confirm();
    expect(dialog.querySelector('[data-slot="icon-tile"]')).toBeNull();
    expect(confirmButton).toHaveClass("bg-destructive-soft");
    expect(cancelButton).toHaveClass("border-input");
  });

  it("draws a soft tile above the title in the tone of the step", () => {
    const { dialog } = confirm({ icon: Ban });
    const tile = dialog.querySelector('[data-slot="icon-tile"]');
    expect(tile).toHaveAttribute("data-tone", "destructive");
    expect(tile).toHaveAttribute("aria-hidden", "true");
    // Above the title: the tile comes first in the header.
    expect(tile?.nextElementSibling).toHaveTextContent("Chặn nhắn tin?");
  });

  it("lets the tile tone differ from the button (a warning before a soft action)", () => {
    const { dialog, confirmButton } = confirm({ icon: Ban, tone: "warning" });
    expect(dialog.querySelector('[data-slot="icon-tile"]')).toHaveAttribute("data-tone", "warning");
    expect(confirmButton).toHaveClass("bg-destructive-soft");
  });

  it("follows a non-destructive step with the info tint", () => {
    const { dialog } = confirm({ icon: Ban, destructive: false });
    expect(dialog.querySelector('[data-slot="icon-tile"]')).toHaveAttribute("data-tone", "info");
  });

  it("fills the confirm solid on request, red only when destructive", () => {
    const { confirmButton } = confirm({ solid: true });
    expect(confirmButton).toHaveClass("bg-destructive-solid");
    expect(confirmButton).not.toHaveClass("bg-destructive-soft");
  });

  it("passes the cancel variant and the class name through", () => {
    const { dialog, cancelButton } = confirm({ cancelVariant: "secondary", className: "rounded-2xl" });
    expect(cancelButton).toHaveClass("bg-secondary");
    expect(dialog).toHaveClass("rounded-2xl");
  });
});

describe("FormDialogFooter cancel variant", () => {
  function cancelOf(props: Partial<Parameters<typeof FormDialogFooter>[0]> = {}) {
    render(
      <Dialog open>
        <FormDialogContent>
          <FormDialogHeader title="Đổi tên phòng" />
          <FormDialogFooter onCancel={() => {}} submitLabel="Lưu" {...props} />
        </FormDialogContent>
      </Dialog>,
    );
    return screen.getByRole("button", { name: "Hủy" });
  }

  it("keeps the outline cancel by default", () => {
    expect(cancelOf()).toHaveClass("border-input");
  });

  it("takes the variant a module asks for", () => {
    const cancel = cancelOf({ cancelVariant: "secondary" });
    expect(cancel).toHaveClass("bg-secondary");
    expect(cancel).not.toHaveClass("border-input");
  });
});

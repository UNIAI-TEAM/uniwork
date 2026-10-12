import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "./form-dialog";

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

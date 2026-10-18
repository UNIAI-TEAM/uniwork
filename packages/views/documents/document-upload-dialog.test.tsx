import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentUploadDialog } from "./document-upload-dialog";

const { t } = initI18n();

function renderDialog(over: Partial<Parameters<typeof DocumentUploadDialog>[0]> = {}) {
  return render(
    <DocumentUploadDialog
      open
      onOpenChange={() => undefined}
      title={t("documents.upload.title")}
      description={t("documents.upload.description")}
      onSubmit={() => undefined}
      {...over}
    />,
  );
}

describe("DocumentUploadDialog", () => {
  it("lets a keyboard user pick a file through the localized Choose file button", () => {
    const onPickFile = vi.fn();
    renderDialog({ onPickFile });

    // The native input is visually hidden and not keyboard reachable: the
    // button is the control.
    const input = document.getElementById("document-upload-file") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input).toHaveClass("sr-only");
    expect(input).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent(
      t("documents.upload.no_file"),
    );

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.pick") }));
    expect(clickSpy).toHaveBeenCalled();

    const file = new File(["x"], "báo-cáo.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(onPickFile).toHaveBeenCalledWith(file);
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("báo-cáo.pdf");
    clickSpy.mockRestore();
  });
});

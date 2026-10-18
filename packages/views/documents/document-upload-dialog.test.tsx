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
    const input = screen.getByLabelText(t("documents.upload.pick")) as HTMLInputElement;
    expect(input).toHaveClass("sr-only");
    // Hidden from assistive tech so browse mode lists one control, and the
    // button announces the chosen file through aria-describedby.
    expect(input).toHaveAttribute("aria-hidden", "true");
    const pickButton = screen.getByRole("button", { name: t("documents.upload.pick") });
    const describedBy = pickButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toBe(screen.getByTestId("document-upload-selected"));
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
    expect(document.getElementById(describedBy!)).toHaveTextContent("báo-cáo.pdf");
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("báo-cáo.pdf");
    clickSpy.mockRestore();
  });

  it("reads 100% on the label and the indicator together, with no final-step transition (D-4)", () => {
    renderDialog({
      chunkedProgress: { phase: "uploading", sentBytes: 100, totalBytes: 100 },
    });

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100%")).toBeInTheDocument();
    // The indicator's transition-all is suppressed on the last step so the
    // label can never say 100% while the bar is still animating toward it.
    // The indicator is a grandchild (root > track > indicator), so a direct
    // child variant (`*:`) never matches it; the descendant variant does.
    const indicator = bar.querySelector('[data-slot="progress-indicator"]');
    expect(indicator).not.toBeNull();
    expect(indicator!.parentElement).toHaveAttribute("data-slot", "progress-track");
    expect(indicator!.parentElement!.parentElement).toBe(bar);
    expect(bar).toHaveClass("**:data-[slot=progress-indicator]:transition-none");
  });

  it("draws the progress track with a visible boundary (R2-F3)", () => {
    renderDialog({
      chunkedProgress: { phase: "uploading", sentBytes: 50, totalBytes: 100 },
    });

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveClass("*:data-[slot=progress-track]:ring-1");
    expect(bar).toHaveClass("*:data-[slot=progress-track]:ring-input");
  });
});

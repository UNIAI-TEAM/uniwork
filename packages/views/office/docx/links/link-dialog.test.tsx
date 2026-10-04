import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkDialog, type LinkDialogProps } from "./index";

const INITIAL = { from: 1, to: 6, href: "https://a.test", rId: null, text: "hello", tooltip: "tip" };

function renderDialog(overrides: Partial<LinkDialogProps> = {}) {
  const props: LinkDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    initial: null,
    selectionText: "",
    onSubmit: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<LinkDialog {...props} />);
  return props;
}

describe("LinkDialog", () => {
  it("prefills the display text from the selection and blocks an empty address", () => {
    renderDialog({ selectionText: "UniWork" });
    expect(screen.getByTestId("docx-link-text")).toHaveValue("UniWork");
    expect(screen.getByTestId("docx-link-url")).toHaveValue("");
    expect(screen.getByTestId("docx-link-submit")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("validates the address and explains what to enter", () => {
    renderDialog();
    const url = screen.getByTestId("docx-link-url");
    fireEvent.change(url, { target: { value: "ftp://uniwork.vn" } });
    expect(screen.getByTestId("docx-link-submit")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Nhập địa chỉ http, https hoặc mailto.");
    fireEvent.change(url, { target: { value: "mailto:hello@uniwork.vn" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("docx-link-submit")).toBeEnabled();
  });

  it("submits trimmed values and lets the caller close", () => {
    const props = renderDialog({ selectionText: "UniWork" });
    fireEvent.change(screen.getByTestId("docx-link-url"), { target: { value: " https://uniwork.vn " } });
    fireEvent.change(screen.getByTestId("docx-link-tooltip"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("docx-link-submit"));
    expect(props.onSubmit).toHaveBeenCalledWith({ href: "https://uniwork.vn", text: "UniWork", tooltip: null });
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("submits on Enter only while the address is valid", () => {
    const props = renderDialog();
    const url = screen.getByTestId("docx-link-url");
    fireEvent.change(url, { target: { value: "ftp://uniwork.vn" } });
    fireEvent.keyDown(url, { key: "Enter" });
    expect(props.onSubmit).not.toHaveBeenCalled();
    fireEvent.change(url, { target: { value: "https://uniwork.vn" } });
    fireEvent.keyDown(url, { key: "Enter" });
    expect(props.onSubmit).toHaveBeenCalledWith({ href: "https://uniwork.vn", text: "", tooltip: null });
  });

  it("cancels on Escape and on the Cancel button", () => {
    const props = renderDialog();
    fireEvent.keyDown(screen.getByTestId("docx-link-dialog"), { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(props.onOpenChange).toHaveBeenCalledTimes(2);
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("edits an existing link and offers Remove", () => {
    const props = renderDialog({ initial: INITIAL });
    expect(screen.getByTestId("docx-link-text")).toHaveValue("hello");
    expect(screen.getByTestId("docx-link-url")).toHaveValue("https://a.test");
    expect(screen.getByTestId("docx-link-tooltip")).toHaveValue("tip");
    expect(screen.getByRole("button", { name: "Bỏ liên kết" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-link-remove"));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("docx-link-submit"));
    expect(props.onSubmit).toHaveBeenCalledWith({ href: "https://a.test", text: "hello", tooltip: "tip" });
  });

  it("keeps the fields visible but blocks insert, edit and remove on a read-only document", () => {
    const props = renderDialog({ initial: INITIAL, readOnly: true });
    expect(screen.getByTestId("docx-link-text")).toBeDisabled();
    expect(screen.getByTestId("docx-link-url")).toBeDisabled();
    expect(screen.getByTestId("docx-link-submit")).toBeDisabled();
    expect(screen.getByTestId("docx-link-remove")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-link-submit"));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});

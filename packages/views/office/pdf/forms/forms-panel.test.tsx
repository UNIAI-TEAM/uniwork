import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfFormsPanel } from "./forms-panel";
import { createPdfFormOperationProvider } from "./provider";
import type {
  PdfFormEngineOperation,
  PdfFormField,
  PdfFormFieldValueInput,
  PdfFormOperationProvider,
  PdfFormOperationSubmitter,
} from "./types";

const FIELDS: readonly PdfFormField[] = [
  { name: "full_name", kind: "text", label: "Họ và tên", value: "Nguyễn An" },
  { name: "agree", kind: "checkbox", label: "Đồng ý điều khoản", value: false },
  { name: "tier", kind: "radio", label: "Gói dịch vụ", value: "basic", options: [{ value: "basic", label: "Cơ bản" }, { value: "pro", label: "Nâng cao" }] },
  { name: "city", kind: "choice", label: "Thành phố", value: "hn", options: [{ value: "hn", label: "Hà Nội" }, { value: "hcm", label: "TP. Hồ Chí Minh" }] },
];

/** Base UI's span-based primitives carry `aria-disabled`, not the native
 * attribute; a native input carries `disabled`. Accept either. */
function disabled(element: HTMLElement): boolean {
  return element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
}

function provider(): PdfFormOperationProvider {
  return { setFormValue: vi.fn(), flattenForms: vi.fn() };
}

describe("PdfFormsPanel", () => {
  it("lists every field with its kind and current value", () => {
    render(<PdfFormsPanel fields={FIELDS} provider={provider()} />);
    expect(screen.getByLabelText("Họ và tên")).toHaveValue("Nguyễn An");
    expect(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radiogroup", { name: "Gói dịch vụ" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Thành phố" })).toBeInTheDocument();
    expect(screen.getByText("Văn bản")).toBeInTheDocument();
    expect(screen.getByText("Hộp kiểm")).toBeInTheDocument();
    expect(screen.getByText("Nút chọn")).toBeInTheDocument();
    expect(screen.getByText("Danh sách chọn")).toBeInTheDocument();
  });

  it("submits a text field once it leaves the field, not on every keystroke", async () => {
    const host = provider();
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    const input = screen.getByLabelText("Họ và tên");
    fireEvent.change(input, { target: { value: "Nguyễn Bình" } });
    expect(host.setFormValue).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() =>
      expect(host.setFormValue).toHaveBeenCalledWith({ name: "full_name", kind: "text", value: "Nguyễn Bình" }),
    );
  });

  it("submits a checkbox change immediately", async () => {
    const host = provider();
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" }));
    await waitFor(() =>
      expect(host.setFormValue).toHaveBeenCalledWith({ name: "agree", kind: "checkbox", value: true }),
    );
  });

  it("submits the picked radio option's export value", async () => {
    const host = provider();
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    fireEvent.click(screen.getByRole("radio", { name: "Nâng cao" }));
    await waitFor(() =>
      expect(host.setFormValue).toHaveBeenCalledWith({ name: "tier", kind: "radio", value: "pro" }),
    );
  });

  it("submits the picked choice option", async () => {
    const host = provider();
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Thành phố" }));
    fireEvent.click(await screen.findByRole("option", { name: "TP. Hồ Chí Minh" }));
    await waitFor(() =>
      expect(host.setFormValue).toHaveBeenCalledWith({ name: "city", kind: "choice", value: "hcm" }),
    );
  });

  it("round-trips a change through a fake provider and shows the new value", async () => {
    let fields: readonly PdfFormField[] = FIELDS;
    const applied: PdfFormFieldValueInput[] = [];
    const submitter: PdfFormOperationSubmitter = {
      submit(operations: readonly PdfFormEngineOperation[]) {
        for (const operation of operations) {
          if (operation.op !== "setFormValue") continue;
          applied.push({ name: operation.field.name, kind: operation.field.kind, value: operation.field.value });
          fields = fields.map((field) =>
            field.name === operation.field.name ? { ...field, value: operation.field.value } : field,
          );
        }
      },
    };
    const host = createPdfFormOperationProvider(submitter);
    const { rerender } = render(<PdfFormsPanel fields={fields} provider={host} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" }));
    await waitFor(() => expect(applied).toEqual([{ name: "agree", kind: "checkbox", value: true }]));
    rerender(<PdfFormsPanel fields={fields} provider={host} />);
    expect(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" })).toHaveAttribute("aria-checked", "true");
  });

  it("submits flattenForms from the flatten toggle and latches it on", async () => {
    const host = provider();
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    fireEvent.click(screen.getByRole("switch", { name: "Làm phẳng biểu mẫu" }));
    await waitFor(() => expect(host.flattenForms).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Đã làm phẳng biểu mẫu.")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Làm phẳng biểu mẫu" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(disabled(toggle)).toBe(true);
  });

  it("shows a localized alert when the host rejects a field write", async () => {
    const host = provider();
    vi.mocked(host.setFormValue).mockRejectedValueOnce(new Error("engine down"));
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể ghi giá trị trường. Thử lại.");
  });

  it("shows a localized alert when flattening fails", async () => {
    const host = provider();
    vi.mocked(host.flattenForms).mockRejectedValueOnce(new Error("engine down"));
    render(<PdfFormsPanel fields={FIELDS} provider={host} />);
    fireEvent.click(screen.getByRole("switch", { name: "Làm phẳng biểu mẫu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể làm phẳng biểu mẫu. Thử lại.");
  });

  it("shows a loading state instead of an empty list while fields load", () => {
    render(<PdfFormsPanel loading provider={provider()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải các trường biểu mẫu…");
    expect(screen.queryByText("Tài liệu này không có trường biểu mẫu.")).not.toBeInTheDocument();
  });

  it("shows the empty state when the document has no form fields", () => {
    render(<PdfFormsPanel fields={[]} provider={provider()} />);
    expect(screen.getByText("Tài liệu này không có trường biểu mẫu.")).toBeInTheDocument();
  });

  it("names a host read failure as an alert instead of faking a field list", () => {
    render(<PdfFormsPanel error="Không đọc được biểu mẫu." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không đọc được biểu mẫu.");
  });

  it("falls back to the localized error copy for an empty failure string", () => {
    render(<PdfFormsPanel error="" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được các trường biểu mẫu.");
  });

  it("keeps every control read-only without a provider", () => {
    render(<PdfFormsPanel fields={FIELDS} />);
    expect(screen.getByLabelText("Họ và tên")).toBeDisabled();
    expect(disabled(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" }))).toBe(true);
    expect(screen.queryByRole("switch", { name: "Làm phẳng biểu mẫu" })).not.toBeInTheDocument();
    expect(screen.getByText("Chỉ đọc")).toBeInTheDocument();
  });

  it("disables every control in a read-only host", () => {
    render(<PdfFormsPanel fields={FIELDS} provider={provider()} readOnly />);
    expect(screen.getByLabelText("Họ và tên")).toBeDisabled();
    expect(disabled(screen.getByRole("checkbox", { name: "Đồng ý điều khoản" }))).toBe(true);
    expect(disabled(screen.getByRole("switch", { name: "Làm phẳng biểu mẫu" }))).toBe(true);
  });

  it("marks a field the host reports read-only", () => {
    render(<PdfFormsPanel fields={[{ name: "locked", kind: "text", label: "Bị khóa", value: "x", readOnly: true }]} provider={provider()} />);
    expect(screen.getByLabelText("Bị khóa")).toBeDisabled();
    expect(screen.getByText("Trường này không chỉnh sửa được.")).toBeInTheDocument();
  });

  it("offers a two-state toggle for a radio the host sent without options", async () => {
    const host = provider();
    render(<PdfFormsPanel fields={[{ name: "signed", kind: "radio", label: "Đã ký", value: false }]} provider={host} />);
    fireEvent.click(screen.getByRole("switch", { name: "Đã ký" }));
    await waitFor(() =>
      expect(host.setFormValue).toHaveBeenCalledWith({ name: "signed", kind: "radio", value: true }),
    );
  });

  it("says a choice field has no options instead of rendering an empty picker", () => {
    render(<PdfFormsPanel fields={[{ name: "city", kind: "choice", label: "Thành phố", value: "" }]} provider={provider()} />);
    expect(screen.getByText("Trường này không có lựa chọn nào.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

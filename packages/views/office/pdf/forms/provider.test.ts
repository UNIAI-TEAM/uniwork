import { describe, expect, it, vi } from "vitest";
import { createPdfFormOperationProvider, PdfFormProviderError } from "./provider";
import type { PdfFormEngineOperation } from "./types";

describe("createPdfFormOperationProvider", () => {
  it("submits a typed setFormValue envelope for a text field", async () => {
    const submit = vi.fn();
    const provider = createPdfFormOperationProvider({ submit });
    await provider.setFormValue({ name: "full_name", kind: "text", value: "Nguyễn An" });
    expect(submit).toHaveBeenCalledWith([
      { op: "setFormValue", field: { name: "full_name", kind: "text", value: "Nguyễn An" } },
    ]);
  });

  it("writes a boolean for a checkbox and a string for a choice", async () => {
    const submitted: PdfFormEngineOperation[][] = [];
    const provider = createPdfFormOperationProvider({
      submit: (operations) => {
        submitted.push([...operations]);
      },
    });
    await provider.setFormValue({ name: "agree", kind: "checkbox", value: true });
    await provider.setFormValue({ name: "city", kind: "choice", value: "hn" });
    await provider.setFormValue({ name: "tier", kind: "radio", value: "pro" });
    expect(submitted).toEqual([
      [{ op: "setFormValue", field: { name: "agree", kind: "checkbox", value: true } }],
      [{ op: "setFormValue", field: { name: "city", kind: "choice", value: "hn" } }],
      [{ op: "setFormValue", field: { name: "tier", kind: "radio", value: "pro" } }],
    ]);
  });

  it("accepts a boolean for a two-state radio", async () => {
    const submit = vi.fn();
    const provider = createPdfFormOperationProvider({ submit });
    await provider.setFormValue({ name: "signed", kind: "radio", value: false });
    expect(submit).toHaveBeenCalledWith([
      { op: "setFormValue", field: { name: "signed", kind: "radio", value: false } },
    ]);
  });

  it("submits a bare flattenForms envelope", async () => {
    const submit = vi.fn();
    const provider = createPdfFormOperationProvider({ submit });
    await provider.flattenForms();
    expect(submit).toHaveBeenCalledWith([{ op: "flattenForms" }]);
  });

  it("refuses malformed inputs as typed errors before touching the submitter", async () => {
    const submit = vi.fn();
    const provider = createPdfFormOperationProvider({ submit });
    await expect(provider.setFormValue({ name: "  ", kind: "text", value: "x" })).rejects.toBeInstanceOf(PdfFormProviderError);
    await expect(provider.setFormValue({ name: "a", kind: "unknown" as never, value: "x" })).rejects.toMatchObject({ code: "invalid_input" });
    // A checkbox with a string value and a text field with a boolean are the
    // two mismatches the engine would silently drop at save time.
    await expect(provider.setFormValue({ name: "agree", kind: "checkbox", value: "yes" as unknown as boolean })).rejects.toBeInstanceOf(PdfFormProviderError);
    await expect(provider.setFormValue({ name: "full_name", kind: "text", value: true as unknown as string })).rejects.toBeInstanceOf(PdfFormProviderError);
    await expect(provider.setFormValue({ name: "tier", kind: "radio", value: 3 as unknown as string })).rejects.toBeInstanceOf(PdfFormProviderError);
    expect(submit).not.toHaveBeenCalled();
  });
});

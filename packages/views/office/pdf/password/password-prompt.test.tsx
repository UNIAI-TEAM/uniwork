// @vitest-environment jsdom
// C3 — the encrypted-PDF password prompt: labelled field, error/alert state,
// focus handling, no persistence, and real keys in both locales.
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PdfPasswordPrompt } from "./password-prompt";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

function setup(overrides: Partial<ComponentProps<typeof PdfPasswordPrompt>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <PdfPasswordPrompt open onSubmit={onSubmit} onCancel={onCancel} {...overrides} />,
  );
  return { view, onSubmit, onCancel };
}

describe("PdfPasswordPrompt", () => {
  it("labels the password field and offers open and cancel", () => {
    setup();
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Open document" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("submits the typed password untrimmed — four spaces are a real password", () => {
    const { onSubmit } = setup();
    const input = screen.getByLabelText("Password");
    fireEvent.change(input, { target: { value: "    " } });
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("    ");
  });

  it("focuses the field on open and re-focuses it on a wrong-password re-prompt", async () => {
    const { view } = setup();
    const input = screen.getByLabelText("Password");
    await waitFor(() => expect(input).toHaveFocus());
    view.rerender(<PdfPasswordPrompt open mode="wrong" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveFocus());
  });

  it("shows the refusal as an alert and marks the field invalid", () => {
    setup({ mode: "wrong" });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That password did not open this document. Try again.",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a host-supplied failure detail in the alert", () => {
    setup({ mode: "wrong", error: "engine refused the password" });
    expect(screen.getByRole("alert")).toHaveTextContent("engine refused the password");
  });

  it("clears the password when the prompt closes and reopens", () => {
    const { view } = setup();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    view.rerender(<PdfPasswordPrompt open={false} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    view.rerender(<PdfPasswordPrompt open onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("never writes the password to browser storage", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const { onSubmit } = setup();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Open document" }));
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("secret");
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("reports a dismissal through onCancel", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("locks the field and actions while pending and refuses a dismissal", () => {
    const { onCancel } = setup({ pending: true });
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders the Vietnamese keys", async () => {
    await setLocale("vi");
    setup();
    expect(screen.getByLabelText("Mật khẩu")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở tài liệu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy" })).toBeInTheDocument();
  });
});

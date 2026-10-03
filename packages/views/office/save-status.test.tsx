import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { SaveStatus } from "./save-status";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

describe("SaveStatus", () => {
  it.each([
    ["checkpoint", "Draft kept on this device", "Send to UniWork"],
    ["saved-local", "Saved on this device", "Save to UniWork"],
    ["saved-cloud", "Saved to UniWork", "Done"],
    ["not-sent", "Changes not sent", "Send now"],
    ["permission", "Editing permission required", "Keep draft"],
    ["conflict", "Save conflict", "Review conflict"],
  ] as const)("maps %s to its shared label and action", (status, label, actionLabel) => {
    const onAction = vi.fn();
    render(<SaveStatus status={status} correlationId="corr-42" onAction={onAction} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Correlation id: corr-42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: actionLabel })).toBeInTheDocument();
  });

  it.each([
    ["dirty", "Changes not sent", "Send now"],
    ["ready", "Ready to save", null],
    ["saving", "Saving…", null],
    ["saved", "Saved to UniWork", "Done"],
    ["error", "Save could not be confirmed", "Try again"],
    ["conflict", "Save conflict", "Review conflict"],
    ["blocked", "Editing permission required", "Keep draft"],
    ["readonly", "Editing permission required", "Keep draft"],
    ["incompatible", "Editing permission required", "Keep draft"],
  ] as const)("maps coordinator state %s", (state, label, actionLabel) => {
    const onAction = vi.fn();
    render(
      <SaveStatus
        coordinatorState={{ state, error: null } as never}
        correlationId="state-correlation"
        onAction={onAction}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Correlation id: state-correlation")).toBeInTheDocument();
    if (actionLabel) expect(screen.getByRole("button", { name: actionLabel })).toBeInTheDocument();
    else expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses coordinator errors and focuses an alert for conflict", () => {
    render(
      <SaveStatus
        coordinatorState={{
          state: "conflict",
          error: {
            state: "conflict",
            code: "revision_conflict",
            errorClass: "conflict",
            correlationId: "corr-conflict",
            retryable: false,
            ambiguous: false,
            action: "resolve_conflict",
            message: "",
          },
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("tabindex", "-1");
    expect(alert).toHaveTextContent("corr-conflict");
  });

  it("keeps a destructive header status compact while exposing its full message", () => {
    render(<SaveStatus status="error" compact />);
    const status = screen.getByTestId("office-save-error-compact");
    expect(status).not.toHaveAttribute("role");
    expect(status).toHaveAttribute("title", "The document was kept. Try again.");
    expect(status).toHaveTextContent("Save could not be confirmed");
    expect(status).toHaveAttribute("aria-describedby");
    expect(document.getElementById(status.getAttribute("aria-describedby")!)).toHaveTextContent("The document was kept. Try again.");
  });

  it("preserves an explicit ready status instead of treating it as a receipt", () => {
    render(<SaveStatus status="ready" />);
    expect(screen.getByText("Ready to save")).toBeInTheDocument();
    expect(screen.getByTestId("office-save-ready")).toBeInTheDocument();
  });
});

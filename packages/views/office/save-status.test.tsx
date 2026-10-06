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
    ["ready", "No changes", null],
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

  it("surfaces the job failure reason in the save-error alert (F4)", () => {
    render(
      <SaveStatus
        coordinatorState={{
          state: "error",
          error: {
            state: "error",
            code: "engine_result_invalid",
            errorClass: "engine",
            correlationId: null,
            retryable: true,
            ambiguous: false,
            action: "retry",
            message: "Office save could not be confirmed",
          },
        }}
      />,
    );
    const reason = screen.getByTestId("office-save-error-reason");
    expect(reason).toHaveTextContent("Reason: engine_result_invalid \u00b7 engine");
  });

  it("explains a known engine refusal in words instead of the bare code", () => {
    render(
      <SaveStatus
        coordinatorState={{
          state: "error",
          error: { state: "error", code: "xlsx_recalc_unavailable", errorClass: "engine", correlationId: null, retryable: false, ambiguous: false, action: "stop", message: "Office save could not be confirmed" },
        }}
      />,
    );
    expect(screen.getByTestId("office-save-error-reason")).toHaveTextContent("Reason: This UniWork Office build does not include the formula engine, so a workbook with formulas cannot be saved on this computer yet. Your changes are kept. · engine");
  });

  it("offers no retry for a missing formula engine and says what to do instead (UNI-940 X06)", () => {
    const onAction = vi.fn();
    const recalcUnavailable = {
      state: "error" as const,
      error: { state: "error" as const, code: "xlsx_recalc_unavailable", errorClass: "engine" as const, correlationId: null, retryable: false, ambiguous: false, action: "stop" as const, message: "Office save could not be confirmed" },
    };
    const { rerender } = render(<SaveStatus coordinatorState={recalcUnavailable} onAction={onAction} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Install the latest UniWork Office, which includes the formula engine, or upload the workbook to UniWork and save it there.");
    expect(alert).not.toHaveTextContent("Try again");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<SaveStatus coordinatorState={recalcUnavailable} onAction={onAction} compact />);
    expect(screen.getByTestId("office-save-error-compact")).toHaveTextContent("Install the latest UniWork Office");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("still offers retry for a save failure a retry can fix", () => {
    const onAction = vi.fn();
    render(
      <SaveStatus
        coordinatorState={{
          state: "error",
          error: { state: "error", code: "engine_result_invalid", errorClass: "engine", correlationId: null, retryable: true, ambiguous: false, action: "retry", message: "" },
        }}
        onAction={onAction}
      />,
    );
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("keys the no-retry banner off retryable=false plus a written fix, not a code list (UNI-953 N3)", () => {
    const error = { state: "error" as const, errorClass: "engine" as const, correlationId: null, ambiguous: false, message: "" };
    // Non-retryable but no office.save.fix.<code> copy: the generic banner keeps its action.
    const { rerender } = render(
      <SaveStatus coordinatorState={{ state: "error", error: { ...error, code: "some_future_refusal", retryable: false, action: "stop" } }} onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // A code with fix copy that the coordinator says is retryable is not suppressed.
    rerender(
      <SaveStatus coordinatorState={{ state: "error", error: { ...error, code: "xlsx_recalc_unavailable", retryable: true, action: "retry" } }} onAction={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("Install the latest UniWork Office");
  });

  it("keeps the generic headline when a save failure carries no code (F4)", () => {
    render(<SaveStatus status="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Save could not be confirmed");
    expect(screen.queryByTestId("office-save-error-reason")).not.toBeInTheDocument();
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

  it.each([
    ["saved-cloud", "Saved", "Saved to UniWork"],
    ["not-sent", "Unsaved", "Changes not sent"],
    ["saving", "Saving…", "Saving…"],
    ["ready", "No changes", "No changes"],
  ] as const)("reads %s in its short header form with the full label as tooltip", (status, short, full) => {
    render(<SaveStatus status={status} compact />);
    const element = screen.getByTestId(`office-save-${status}`);
    expect(element).toHaveTextContent(short);
    expect(element).toHaveAttribute("title", full);
  });

  it("preserves an explicit ready status instead of treating it as a receipt", () => {
    render(<SaveStatus status="ready" />);
    expect(screen.getByText("No changes")).toBeInTheDocument();
    expect(screen.getByTestId("office-save-ready")).toBeInTheDocument();
  });
});

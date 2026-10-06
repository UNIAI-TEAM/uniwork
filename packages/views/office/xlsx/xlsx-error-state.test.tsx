import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxOpenFailure } from "./types";
import { XlsxErrorState } from "./xlsx-error-state";

// The views suite runs in vi (test/setup.ts beforeAll), so the screen renders
// Vietnamese copy; read it from the locale object rather than hardcoding.
const errors = viLocale.office.xlsx.errors;

function failure(overrides: Partial<XlsxOpenFailure> = {}): XlsxOpenFailure {
  return { outcome: "failed", document_id: "doc", format: "xlsx", failure_class: "engine_error", ...overrides };
}

function loggedPayload(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.at(-1);
  return (call?.at(-1) ?? {}) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("XlsxErrorState", () => {
  it("offers only Retry, like the other formats: the desktop AI header button is not part of this screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<XlsxErrorState failure={failure()} onRetry={() => {}} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([viLocale.office.xlsx.actions.retryOpen]);
  });

  it("logs the real engine_error cause and shows a sanitized detail outside the alert", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<XlsxErrorState failure={failure({ message: "engine crashed while parsing sheet 3" })} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(errors.title);
    expect(error).toHaveBeenCalledTimes(1);
    expect(loggedPayload(error)).toMatchObject({
      failure_class: "engine_error",
      message: "engine crashed while parsing sheet 3",
      code: null,
    });
    const details = screen.getByTestId("xlsx-error-details");
    expect(details).toHaveTextContent("engine crashed while parsing sheet 3");
    expect(screen.getByRole("alert")).not.toHaveTextContent("engine crashed");
  });

  it("shows the engine error code and keeps only the first message line", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<XlsxErrorState failure={failure({ message: "first line\nsecond line", engine_error: "engine_crashed" })} />);

    const details = screen.getByTestId("xlsx-error-details");
    expect(details).toHaveTextContent("first line");
    expect(details).not.toHaveTextContent("second line");
    expect(details).toHaveTextContent("engine_crashed");
    expect(loggedPayload(error)).toMatchObject({ message: "first line\nsecond line", code: "engine_crashed" });
  });

  it("renders the friendly headline without an empty details row for a message-less failure", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<XlsxErrorState failure={failure()} />);

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(errors.title);
    expect(screen.getByRole("alert")).toHaveTextContent(errors.engine_error);
    expect(screen.queryByTestId("xlsx-error-details")).not.toBeInTheDocument();
    expect(error).toHaveBeenCalledTimes(1);
    expect(loggedPayload(error)).toMatchObject({ failure_class: "engine_error", message: null, code: null });
  });
});
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { QuotaMeterRow } from "./quota-meter";

initI18n();

describe("QuotaMeterRow", () => {
  it("does not show exhausted styling when rounded display would hit 100% but usage is below limit", () => {
    render(<QuotaMeterRow label="Token AI" used={995_000} limit={1_000_000} unit="tokens" />);
    expect(screen.queryByText("Đã hết")).toBeNull();
    const bar = screen.getByRole("progressbar", { name: "Token AI" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/Còn/)).toBeInTheDocument();
  });

  it("shows exhausted styling only when used meets or exceeds the limit", () => {
    render(<QuotaMeterRow label="Token AI" used={1_000_000} limit={1_000_000} unit="tokens" />);
    expect(screen.getByText("Đã hết")).toBeInTheDocument();
  });
});

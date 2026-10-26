import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AskUniSourcesBar } from "./ask-uni-sources-bar";

initI18n();

describe("AskUniSourcesBar", () => {
  it("names each outside app as coming soon, in order", () => {
    render(<AskUniSourcesBar />);
    const list = screen.getByRole("list", { name: "Ứng dụng kết nối" });
    expect(within(list).getAllByRole("img").map((i) => i.getAttribute("aria-label"))).toEqual([
      "Google Drive · Sắp có",
      "Slack · Sắp có",
      "Gmail · Sắp có",
      "GitHub · Sắp có",
    ]);
  });

  it("keeps adding an app focusable but disabled until connectors ship", () => {
    render(<AskUniSourcesBar />);
    const more = screen.getByRole("button", { name: "Kết nối thêm ứng dụng · Sắp có" });
    expect(more).toHaveAttribute("aria-disabled", "true");
    expect(more).not.toBeDisabled();
  });

  it("hides when asked", () => {
    const { container } = render(<AskUniSourcesBar />);
    fireEvent.click(screen.getByRole("button", { name: "Ẩn thanh nguồn" }));
    expect(container.querySelector("[data-slot=ask-uni-sources]")).toBeNull();
  });
});

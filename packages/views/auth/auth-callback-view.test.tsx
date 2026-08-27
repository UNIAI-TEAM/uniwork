import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AuthCallbackView } from "./auth-callback-view";

initI18n();

describe("AuthCallbackView", () => {
  it("announces the wait exactly once, in the product's language", () => {
    render(<AuthCallbackView />);
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("Đang đăng nhập bằng Google…");
    expect(document.body.innerHTML).not.toContain("Loading");
    // The page still needs a heading for the landmark list; the status
    // line is the only content, so it is the heading.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Đang đăng nhập bằng Google…");
    expect(screen.getAllByText("Đang đăng nhập bằng Google…")).toHaveLength(1);
  });
});

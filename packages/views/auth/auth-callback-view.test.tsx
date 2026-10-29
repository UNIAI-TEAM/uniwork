import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { AuthCallbackView } from "./auth-callback-view";

initI18n();

beforeEach(async () => {
  await setLocale("vi");
});

describe("AuthCallbackView", () => {
  it("announces the wait exactly once, in the product's language, naming no provider", () => {
    render(<AuthCallbackView />);
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("Đang đăng nhập…");
    expect(document.body.innerHTML).not.toContain("Loading");
    expect(document.body.textContent).not.toMatch(/Google|Apple/);
    // The page still needs a heading for the landmark list; the status
    // line is the only content, so it is the heading.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Đang đăng nhập…");
    expect(screen.getAllByText("Đang đăng nhập…")).toHaveLength(1);
  });

  it("stands on the sign-in screens' shell plane with the mark, which a screen reader skips", () => {
    const { container } = render(<AuthCallbackView />);
    const main = screen.getByRole("main");
    expect(main.className).toContain("bg-app-shell");
    const mark = container.querySelector("svg");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("speaks English after a language switch", async () => {
    await setLocale("en");
    render(<AuthCallbackView />);
    expect(screen.getByRole("status")).toHaveTextContent("Signing you in…");
  });
});

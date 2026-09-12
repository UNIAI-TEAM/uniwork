import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { EmailChipsInput, parseEmails } from "./email-chips-input";

initI18n();

function H({ initial = [], disabled }: { initial?: string[]; disabled?: boolean }) {
  const [v, setV] = useState<string[]>(initial);
  return <EmailChipsInput id="e" value={v} onChange={setV} disabled={disabled} />;
}

describe("EmailChipsInput", () => {
  it("parseEmails splits on separators and dedupes", () => {
    expect(parseEmails("a@x.com, B@x.com; a@x.com c@x.com\n")).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
  it("Enter and paste add chips; invalid marked", () => {
    render(<H />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "a@x.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
    fireEvent.paste(input, { clipboardData: { getData: () => "b@x.com, bad" } });
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
    expect(screen.getByText("bad").closest("[data-invalid]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Xóa bad/ }));
    expect(screen.queryByText("bad")).toBeNull();
  });

  /**
   * A chip is a flex item, so `min-width: auto` kept one overlong address from
   * either wrapping or shrinking; the step's `overflow-y-auto` ancestor then
   * computed `overflow-x: auto` and the whole step grew a horizontal scrollbar.
   * Same discipline as `invite-row.tsx`, plus a `title` so the truncated text
   * stays readable.
   */
  it("truncates an overlong address inside the chip instead of stretching it", () => {
    const long = `${"a".repeat(120)}@example.com`;
    render(<H initial={[long]} />);
    const text = screen.getByText(long);
    expect(text.className).toContain("truncate");
    expect(text.className).toContain("min-w-0");
    expect(text).toHaveAttribute("title", long);
    const chip = text.closest("span[class*='rounded-full']");
    expect(chip?.className).toContain("max-w-full");
    expect(chip?.className).toContain("min-w-0");
  });

  /**
   * The repo contract for an inactive control is `aria-disabled` plus a JS
   * guard: native `disabled` removed every chip's delete button from the tab
   * order while a batch was sending, so a keyboard user found the chips gone
   * from navigation with nothing explaining why.
   */
  it("keeps the delete buttons focusable while sending, and refuses the click", () => {
    render(<H initial={["a@x.com"]} disabled />);
    const del = screen.getByRole("button", { name: /Xóa a@x.com/ });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    expect(screen.getByText("a@x.com")).toBeInTheDocument();
  });

  /**
   * The recipient count and the invalid summary used to be two live regions
   * changing on the same Enter press, with `aria-describedby` queueing a third
   * reading on next focus. One settled string, one region.
   */
  it("announces the count and the invalid summary through a single settled live region", async () => {
    const { container } = render(<H />);
    const input = screen.getByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => "a@x.com, bad" } });
    expect(container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(1);
    expect(input).not.toHaveAttribute("aria-describedby");
    const status = screen.getByRole("status");
    await waitFor(() => {
      expect(status.textContent).toContain("2 người nhận");
      expect(status.textContent).toContain("chưa đúng định dạng");
    });
  });

  it("hides the visual invalid summary from the accessibility tree", () => {
    render(<H initial={["bad"]} />);
    const paragraph = document.querySelector("p");
    expect(paragraph?.textContent).toContain("chưa đúng định dạng");
    expect(paragraph).toHaveAttribute("aria-hidden", "true");
  });

  it("does not lose a chip to a stale handler after a re-render", () => {
    const onChange = vi.fn();
    render(<EmailChipsInput id="e2" value={["a@x.com", "b@x.com"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Xóa a@x.com/ }));
    expect(onChange).toHaveBeenCalledWith(["b@x.com"]);
  });
});

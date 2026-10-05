// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { BackgroundColourField, type BackgroundColourFieldProps } from "./index";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

function field() {
  const found = document.querySelector<HTMLInputElement>('[data-testid="html-style-background-hex"]');
  if (!found) throw new Error("colour field input not found");
  return found;
}

const FIELD_PROPS: BackgroundColourFieldProps = { value: null, disabled: false, onPick: () => {} };

describe("BackgroundColourField", () => {
  it("pins the public prop shape", () => {
    expect(FIELD_PROPS.disabled).toBe(false);
    expect(FIELD_PROPS.value).toBeNull();
  });

  it("reports a swatch pick and the clear row", () => {
    const onPick = vi.fn();
    render(<BackgroundColourField value={null} onPick={onPick} />);
    fireEvent.click(document.querySelector<HTMLElement>('[data-bg-swatch="#2563eb"]')!);
    expect(onPick).toHaveBeenCalledWith("#2563eb");
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="html-style-background-none"]')!);
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("reports a typed hex once it parses, and a clear when emptied", () => {
    const onPick = vi.fn();
    render(<BackgroundColourField value={null} onPick={onPick} />);
    fireEvent.change(field(), { target: { value: "#AB" } });
    // A partial value is a draft: nothing is reported yet.
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "#ABC" } });
    expect(onPick).toHaveBeenLastCalledWith("#aabbcc");
    fireEvent.change(field(), { target: { value: "" } });
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("never reports text that is not a hex colour", () => {
    const onPick = vi.fn();
    render(<BackgroundColourField value={null} onPick={onPick} />);
    fireEvent.change(field(), { target: { value: "javascript:alert(1)" } });
    expect(onPick).not.toHaveBeenCalled();
  });

  it("follows a value the caller replaces", () => {
    const { rerender } = render(<BackgroundColourField value={null} onPick={vi.fn()} />);
    expect(field().value).toBe("");
    rerender(<BackgroundColourField value="#16a34a" onPick={vi.fn()} />);
    expect(field().value).toBe("#16a34a");
  });
});

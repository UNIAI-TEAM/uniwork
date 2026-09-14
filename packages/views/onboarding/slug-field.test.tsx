import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { SlugFields, useSlugForm } from "./slug-field";
import { SLUG_MAX_LENGTH } from "../workspace/slug";

initI18n();

function Harness({ disabled, onEnter = () => {} }: { disabled?: boolean; onEnter?: () => void }) {
  const form = useSlugForm();
  return (
    <SlugFields idPrefix="x" form={form} hostPrefix="uniwork.app/" nameLabel="Tên" namePlaceholder="" urlLabel="Đường dẫn"
      slugPlaceholder="" onEnter={onEnter} disabled={disabled} withRandom
      preview={{ title: "Xem trước", body: <span className="font-mono">uniwork.app/doi-alpha</span> }} />
  );
}

describe("SlugFields", () => {
  it("auto-slugs from name until slug is touched; validates format and reserved", () => {
    render(<Harness />);
    const name = screen.getByLabelText("Tên");
    const slug = screen.getByLabelText("Đường dẫn");
    fireEvent.change(name, { target: { value: "Đội Alpha" } });
    expect(slug).toHaveValue("doi-alpha");
    fireEvent.change(slug, { target: { value: "login" } });
    expect(screen.getByRole("alert")).toHaveTextContent("dành riêng");
    fireEvent.change(slug, { target: { value: "Bad Slug" } });
    expect(screen.getByRole("alert")).toHaveTextContent("chữ thường");
    fireEvent.change(name, { target: { value: "Khác" } });
    expect(slug).toHaveValue("Bad Slug"); // đã chạm slug → không auto nữa
  });

  // Regression: `randomize` used to latch the same "touched" flag the slug
  // input sets, so pressing "Ngẫu nhiên" to see what it does and then typing
  // the real name left the workspace permanently at the generated URL.
  it("keeps re-deriving the slug after randomize until the user types in the slug field", () => {
    render(<Harness />);
    const name = screen.getByLabelText("Tên");
    const slug = screen.getByLabelText("Đường dẫn");

    fireEvent.click(screen.getByRole("button", { name: /ngẫu nhiên/i }));
    const random = (slug as HTMLInputElement).value;
    expect(random).not.toBe("");
    expect((name as HTMLInputElement).value).not.toBe("");

    fireEvent.change(name, { target: { value: "Đội Alpha" } });
    expect(slug).toHaveValue("doi-alpha");
    expect(slug).not.toHaveValue(random);

    // And a slug the user typed still wins over a later rename.
    fireEvent.change(slug, { target: { value: "doi-alpha-2" } });
    fireEvent.change(name, { target: { value: "Đội Beta" } });
    expect(slug).toHaveValue("doi-alpha-2");
  });

  it("reports the length rule the server enforces, on both ends, and never on an empty slug", () => {
    render(<Harness />);
    const name = screen.getByLabelText("Tên");
    const slug = screen.getByLabelText("Đường dẫn");

    fireEvent.change(name, { target: { value: "A" } });
    expect(slug).toHaveValue("a");
    expect(screen.getByRole("alert")).toHaveTextContent("2 đến 40");

    // 58 characters through the real slugify path.
    fireEvent.change(name, { target: { value: "Công ty Cổ phần Thương mại Dịch vụ Xuất nhập khẩu Việt Nam" } });
    expect((slug as HTMLInputElement).value.length).toBeGreaterThan(SLUG_MAX_LENGTH);
    expect(screen.getByRole("alert")).toHaveTextContent("2 đến 40");

    fireEvent.change(name, { target: { value: "" } });
    expect(slug).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(name, { target: { value: "Đội Alpha" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("caps the slug input at the server's ceiling", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Đường dẫn")).toHaveAttribute("maxlength", String(SLUG_MAX_LENGTH));
  });

  // Contract from packages/views/test/inactive.ts: a pending step must not use
  // native `disabled`, which drops focus out of the focused input to <body>.
  it("stays focusable while pending, blocks editing and blocks a second submit", () => {
    const onEnter = vi.fn();
    render(<Harness disabled onEnter={onEnter} />);
    const name = screen.getByLabelText("Tên");
    const slug = screen.getByLabelText("Đường dẫn");
    const random = screen.getByRole("button", { name: /ngẫu nhiên/i });

    for (const el of [name, slug, random]) {
      expect(el).not.toBeDisabled();
      expect(el).toHaveAttribute("aria-disabled", "true");
    }
    expect(name).toHaveAttribute("readonly");
    expect(slug).toHaveAttribute("readonly");

    slug.focus();
    expect(document.activeElement).toBe(slug);
    fireEvent.keyDown(slug, { key: "Enter" });
    expect(onEnter).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(slug);

    fireEvent.click(random);
    expect(slug).toHaveValue("");
  });

  it("submits on Enter when not pending, and never while composing with an IME", () => {
    const onEnter = vi.fn();
    render(<Harness onEnter={onEnter} />);
    const slug = screen.getByLabelText("Đường dẫn");
    fireEvent.keyDown(slug, { key: "Enter", keyCode: 229 });
    expect(onEnter).not.toHaveBeenCalled();
    fireEvent.keyDown(slug, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  // The preview renders host + slug as one unbreakable font-mono token inside a
  // 28rem column whose scroll container computes overflow-x: auto.
  it("lets the URL preview wrap instead of widening the column", () => {
    render(<Harness />);
    expect(screen.getByText("uniwork.app/doi-alpha").closest("[data-slot=field-description]")).toHaveClass("wrap-anywhere");
  });

  // The random button sits beside a 40px input; size="lg" alone is 36px.
  it("matches the random button height to the name input at both pointer sizes", () => {
    render(<Harness />);
    const random = screen.getByRole("button", { name: /ngẫu nhiên/i });
    expect(random).toHaveClass("h-10");
    expect(random).toHaveClass("pointer-coarse:h-11");
    expect(screen.getByLabelText("Tên")).toHaveClass("h-10", "pointer-coarse:h-11");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { SlugFields, useSlugForm } from "./slug-field";

initI18n();

function Harness() {
  const form = useSlugForm();
  return (
    <SlugFields idPrefix="x" form={form} hostPrefix="uniwork.app/" nameLabel="Tên" namePlaceholder="" urlLabel="Đường dẫn"
      slugPlaceholder="" onEnter={() => {}} withRandom />
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
});

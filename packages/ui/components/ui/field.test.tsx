import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldError, FieldGroup, FieldLabel } from "./field";

describe("Field", () => {
  it("renders slots and error with role=alert", () => {
    render(
      <FieldGroup>
        <Field data-invalid>
          <FieldLabel htmlFor="a">Tên</FieldLabel>
          <input id="a" />
          <FieldError>Lỗi</FieldError>
        </Field>
      </FieldGroup>,
    );
    expect(screen.getByLabelText("Tên")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Lỗi");
    expect(document.querySelector('[data-slot="field-group"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="field"]')).not.toBeNull();
  });
});

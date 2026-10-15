import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsFieldError, SettingsSaveState } from "./settings-layout";

describe("SettingsSaveState", () => {
  it("exposes role=status when saving", () => {
    render(
      <SettingsSaveState
        status="saved"
        savingLabel="Saving"
        savedLabel="Saved"
        errorLabel="Error"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });
});

describe("SettingsFieldError", () => {
  it("is a polite live region that exists, empty, before its message", () => {
    const { container, rerender } = render(<SettingsFieldError id="e">{null}</SettingsFieldError>);
    const region = container.querySelector("#e")!;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    rerender(<SettingsFieldError id="e">Chưa khớp</SettingsFieldError>);
    // The same node fills in, so a screen reader hears it without an
    // assertive interruption on every keystroke.
    expect(container.querySelector("#e")).toBe(region);
    expect(region).toHaveTextContent("Chưa khớp");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays quiet inside a container that already announces", () => {
    const { container } = render(
      <SettingsFieldError id="e" live={false}>
        Refused
      </SettingsFieldError>,
    );
    expect(container.querySelector("#e")).not.toHaveAttribute("aria-live");
  });
});

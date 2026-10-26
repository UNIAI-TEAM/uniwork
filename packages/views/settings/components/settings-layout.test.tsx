import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsFieldError, SettingsList, SettingsListItem, SettingsSaveState } from "./settings-layout";

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

describe("SettingsListItem", () => {
  it("keeps default non-wrapping title and center alignment unless opted in", () => {
    render(
      <SettingsList aria-label="Items">
        <SettingsListItem
          data-testid="default-row"
          leading={<span>DefaultIcon</span>}
          title="Email Hub"
          badge={<span>Badge</span>}
          actions={<button type="button">Open</button>}
        />
      </SettingsList>,
    );
    const defaultRow = screen.getByTestId("default-row");
    expect(defaultRow.tagName).toBe("LI");
    expect(defaultRow).toHaveClass("items-center");
    expect(defaultRow).not.toHaveClass("items-start", "rounded-sm");
    expect(screen.getByText("Email Hub").parentElement).toHaveClass("gap-2");
    expect(screen.getByText("Email Hub").parentElement).not.toHaveClass("flex-wrap", "gap-y-1");
    expect(screen.getByText("DefaultIcon").parentElement).not.toHaveClass("mt-0.5");
    expect(screen.getByRole("button", { name: "Open" }).parentElement).not.toHaveClass("mt-0.5");
  });

  it("wraps badges below the title and top-aligns leading and actions with identical offset when opted in", () => {
    render(
      <SettingsList aria-label="Items">
        <SettingsListItem
          align="start"
          wrapTitle
          tabIndex={-1}
          data-testid="item-row"
          className="rounded-sm focus-visible:-outline-offset-2"
          leading={<span>Icon</span>}
          title="Google Drive"
          badge={<span>Badge</span>}
          actions={<button type="button">Action</button>}
        />
      </SettingsList>,
    );
    const row = screen.getByTestId("item-row");
    expect(row.tagName).toBe("LI");
    expect(row).toHaveClass("items-start", "rounded-sm", "focus-visible:-outline-offset-2");
    expect(row).not.toHaveClass("outline-none");
    expect(row).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("Google Drive").parentElement).toHaveClass("flex-wrap", "gap-x-2", "gap-y-1");
    expect(screen.getByText("Icon").parentElement).toHaveClass("mt-0.5");
    expect(screen.getByRole("button", { name: "Action" }).parentElement).toHaveClass("mt-0.5");
  });
});

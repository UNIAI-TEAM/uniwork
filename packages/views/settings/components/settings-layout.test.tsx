import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsSaveState } from "./settings-layout";

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

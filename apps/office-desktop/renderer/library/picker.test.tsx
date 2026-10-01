/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesktopLibraryContextResponse } from "../../shared/ipc";
import { LibraryPicker } from "./picker";

const context: DesktopLibraryContextResponse = {
  deployments: [{ id: "default", name: "Default" }],
  accounts: [{ id: "acc-1", name: "acc@example.com" }],
  organizations: [{ id: "org-1", name: "Acme" }],
  workspaces: [{ id: "ws-1", name: "Team" }],
};

it("shows a loading skeleton before context arrives", () => {
  const { container } = render(<LibraryPicker context={null} onChoose={vi.fn()} />);
  expect(container.querySelector("[data-desktop-library-picker]")).not.toBeNull();
  expect(screen.queryByText("Default")).not.toBeInTheDocument();
});

it("preselects singleton groups and enables the choose action", () => {
  const onChoose = vi.fn();
  render(<LibraryPicker context={context} onChoose={onChoose} />);
  const choose = screen.getByRole("button", { name: "Mở tài liệu" });
  expect(choose).toBeEnabled();
  choose.click();
  expect(onChoose).toHaveBeenCalledWith({ deploymentId: "default", accountId: "acc-1", organizationId: "org-1", workspaceId: "ws-1" });
});

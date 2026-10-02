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

it("hides singleton groups behind a summary and asks only where there is a choice", () => {
  render(<LibraryPicker context={{ ...context, deployments: [{ id: "default", name: "uniwork.vn" }], workspaces: [{ id: "ws-1", name: "Team" }, { id: "ws-2", name: "Ops" }] }} onChoose={vi.fn()} />);
  expect(screen.queryByRole("radiogroup", { name: "Máy chủ" })).not.toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Tài khoản" })).not.toBeInTheDocument();
  expect(screen.getByText("uniwork.vn")).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Workspace" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mở tài liệu" })).toBeDisabled();
  expect(screen.getByText("Chọn: Workspace")).toBeInTheDocument();
});

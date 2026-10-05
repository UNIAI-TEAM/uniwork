/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { WorkspaceAlerts } from "./workspace-alert";

it("renders nothing without alerts", () => {
  const { container } = render(<WorkspaceAlerts items={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it("overlays each alert out of flow with role=alert and an icon", () => {
  const { container } = render(<WorkspaceAlerts items={[{ id: "a", message: "Boom" }, { id: "b", message: "Again" }]} />);
  const alerts = screen.getAllByRole("alert");
  expect(alerts.map((alert) => alert.textContent)).toEqual(["Boom", "Again"]);
  expect(container.firstElementChild).toHaveClass("absolute", "pointer-events-none");
  expect(alerts[0]!.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("dismisses only alerts that offer it", () => {
  const onDismiss = vi.fn();
  render(<WorkspaceAlerts items={[{ id: "a", message: "One-off", onDismiss }, { id: "b", message: "Ongoing" }]} />);
  const buttons = screen.getAllByRole("button", { name: i18n.t("officeDesktop.tabs.dismissAlert") });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0]!);
  expect(onDismiss).toHaveBeenCalledOnce();
});

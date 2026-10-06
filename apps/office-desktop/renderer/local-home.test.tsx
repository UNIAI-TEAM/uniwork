/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import type { RecentFile } from "../shared/ipc";
import { LocalHomeView } from "./local-home";

const row = (overrides: Partial<RecentFile> = {}): RecentFile => ({ id: `recent_${"a".repeat(32)}`, name: "Plan.docx", directory: "…\\Docs", modifiedAtMs: 1, updatedAt: 2, missing: false, ...overrides });
const actions = () => ({ onOpen: vi.fn(), onCreate: vi.fn(), onOpenRecent: vi.fn(), onRemoveRecent: vi.fn(), onRetry: vi.fn() });

it("shows a loading skeleton while the list is unknown", () => {
  const { container } = render(<LocalHomeView files={null} {...actions()} />);
  expect(container.querySelector("[data-local-home='true']")).not.toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

it("shows the empty illustration with both primary actions", async () => {
  const callbacks = actions();
  render(<LocalHomeView files={[]} {...callbacks} />);
  expect(screen.getByText(i18n.t("officeDesktop.local.empty"))).toBeInTheDocument();
  expect(screen.getByText(i18n.t("officeDesktop.local.emptyDescription"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.create") }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(i18n.t("officeDesktop.tabs.createHtml")) }));
  expect(callbacks.onOpen).toHaveBeenCalledOnce();
  expect(callbacks.onCreate).toHaveBeenCalledExactlyOnceWith("html");
});

it("shows a typed error with retry", () => {
  const callbacks = actions();
  render(<LocalHomeView files={null} error {...callbacks} />);
  expect(screen.getByRole("alert")).toHaveTextContent(i18n.t("officeDesktop.local.error"));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.retry") }));
  expect(callbacks.onRetry).toHaveBeenCalledOnce();
});

it("lists name, shortened directory and time, dims a missing file and opens the present one", () => {
  const callbacks = actions();
  const present = row();
  const missing = row({ id: `recent_${"b".repeat(32)}`, name: "Gone.docx", missing: true });
  render(<LocalHomeView files={[present, missing]} {...callbacks} />);
  expect(screen.getByText("Plan.docx")).toBeInTheDocument();
  expect(screen.getAllByText(/…\\Docs/)).toHaveLength(2);
  const missingItem = screen.getByText("Gone.docx").closest("li")!;
  expect(missingItem).toHaveAttribute("data-missing", "true");
  expect(within(missingItem).getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Gone.docx" }) })).toBeDisabled();
  expect(within(missingItem).getByText(i18n.t("officeDesktop.local.missing"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Plan.docx" }) }));
  expect(callbacks.onOpenRecent).toHaveBeenCalledWith(present.id);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.removeNamed", { name: "Gone.docx" }) }));
  expect(callbacks.onRemoveRecent).toHaveBeenCalledWith(missing.id);
});

it("keeps recent rows compact while the open and remove controls keep a coarse-pointer target", () => {
  render(<LocalHomeView files={[row()]} {...actions()} />);
  const item = screen.getByText("Plan.docx").closest("li")!;
  expect(item).toHaveClass("px-2", "py-1");
  expect(item).not.toHaveClass("p-3");
  expect(screen.getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Plan.docx" }) })).toHaveClass("pointer-coarse:min-h-11");
  expect(screen.getByRole("button", { name: i18n.t("officeDesktop.local.removeNamed", { name: "Plan.docx" }) })).toHaveClass("pointer-coarse:min-h-11");
});

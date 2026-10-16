import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { SidebarProvider } from "@uniwork/ui/components/ui/sidebar";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceSwitcher } from "./workspace-switcher";

initI18n();

const me: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const alpha: Workspace = {
  id: "w1", slug: "alpha", name: "Alpha", organization_id: "o1", organization_slug: "acme",
  organization_name: "Acme", description: "Nhóm làm sản phẩm", icon_emoji: "🚀",
};
const beta: Workspace = {
  id: "w2", slug: "beta", name: "Beta", organization_id: "o1", organization_slug: "acme",
  organization_name: "Acme", description: "",
};

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/workspaces") ? { workspaces: [alpha, beta] } : {}),
  );
});

describe("WorkspaceSwitcher", () => {
  it("shows the emoji on the trigger and each description under its name", async () => {
    render(wrapWithNav(<SidebarProvider><WorkspaceSwitcher current={alpha} /></SidebarProvider>));
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    expect(trigger).toHaveTextContent("🚀");
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: /Alpha/ })).toHaveTextContent("Nhóm làm sản phẩm");
    // An empty description draws no second line.
    expect(screen.getByRole("menuitem", { name: /Beta/ }).querySelector("span.block.text-caption")).toBeNull();
  });
});

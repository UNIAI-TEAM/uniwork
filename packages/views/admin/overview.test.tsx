import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { NavigationAdapter } from "../navigation";
import { AdminOverviewView } from "./overview";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const system = {
  version: "1.4.0", commit: "2b47dca", migration_embedded: "106_x",
  readiness: { ready: false, checks: [{ name: "db", ok: true, detail: "" }, { name: "redis", ok: false, detail: "refused" }] },
  outbox_pending: 7, outbox_dead: 2, outbox_oldest_pending_age_seconds: 90.4,
  realtime_connections: 42, flag_providers: ["db"],
};

function nav(): NavigationAdapter {
  return {
    push: () => undefined, replace: () => undefined, back: () => undefined,
    pathname: "/admin", searchParams: new URLSearchParams(), getShareableUrl: (p) => p,
  };
}

/** The console home answers one question per tile; each tile is one request's worth of data. */
function route(path: string) {
  if (path.startsWith("/api/v1/admin/system")) return Promise.resolve(system);
  if (path.includes("status=suspended")) return Promise.resolve({ organizations: [], total: 3, limit: 1, offset: 0 });
  return Promise.resolve({ organizations: [], total: 128, limit: 1, offset: 0 });
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
  requestMock.mockImplementation(route);
});

describe("AdminOverviewView", () => {
  it("leads with readiness, dead letters, tenant counts and where to go next", async () => {
    render(wrapWithNav(<AdminOverviewView />, nav()));
    expect(await screen.findByText("Chưa sẵn sàng")).toBeInTheDocument();
    // The failing check is named on the front page, not one screen deeper.
    expect(screen.getByText("redis")).toBeInTheDocument();
    expect(screen.getByText("Cũ nhất 90 giây")).toBeInTheDocument();
    expect(await screen.findByText("128")).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở danh sách tổ chức" })).toHaveAttribute("href", "/admin/organizations");
    expect(screen.getByRole("link", { name: "Xem chi tiết hệ thống" })).toHaveAttribute("href", "/admin/system");
  });

  it("shows the error state when the system response drifted", async () => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ version: 5 });
    render(wrapWithNav(<AdminOverviewView />, nav()));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được tình trạng nền tảng");
  });
});

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { AdminSystemView } from "./system";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminSystemView", () => {
  it("lists readiness checks, versions, outbox, realtime and the provider chain", async () => {
    requestMock.mockResolvedValue({
      version: "1.4.0", commit: "2b47dca", migration_embedded: "106_organizations_status_idx",
      readiness: { ready: false, checks: [{ name: "db", ok: true, detail: "" }, { name: "redis", ok: false, detail: "dial tcp: refused" }] },
      outbox_pending: 3, outbox_dead: 1, outbox_oldest_pending_age_seconds: 12.6, realtime_connections: 42, flag_providers: ["db", "static", "env"],
    });
    render(wrap(<AdminSystemView />));
    expect(await screen.findByText("Không đạt")).toBeInTheDocument();
    expect(screen.getByText("dial tcp: refused")).toBeInTheDocument();
    expect(screen.getByText("106_organizations_status_idx")).toBeInTheDocument();
    expect(screen.getByText("13 giây")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("db → static → env")).toBeInTheDocument();
  });

  it("shows the error state when the response drifted", async () => {
    requestMock.mockResolvedValue({ version: 5 });
    render(wrap(<AdminSystemView />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được trạng thái hệ thống");
  });
});

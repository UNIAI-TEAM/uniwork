import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { AdminFlagsView } from "./flags";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "A",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const flags = [
  { key: "agents_assignee", description: "Hiện agent trong picker", default: false, public: true, owner: "platform", review_at: "2026-12-01", override_count: 1 },
  { key: "admin_quota", description: "Màn hạn mức", default: false, public: false, owner: "platform", review_at: "2026-12-01", override_count: 0 },
];
const override = {
  id: "ov1", flag_key: "agents_assignee", scope_type: "global", scope_id: "", enabled: true,
  note: "", created_by: "u1", created_at: "2026-09-06T00:00:00Z", expires_at: "",
};

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
});

describe("AdminFlagsView", () => {
  it("reads every override once, not once per row", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/overrides") ? { overrides: [override] } : { flags }),
    );
    render(wrap(<AdminFlagsView />));
    expect(await screen.findByText("agents_assignee")).toBeInTheDocument();
    const overrideCalls = requestMock.mock.calls.map(String).filter((c) => c.includes("/overrides"));
    expect(overrideCalls).toEqual(["/api/v1/admin/flags/overrides"]);
    // The row shows the effective value from that one payload.
    expect(screen.getByRole("switch", { name: "Override agents_assignee" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Override admin_quota" })).not.toBeChecked();
  });

  it("asks for a reason before it flips a switch", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.includes("/overrides") ? { overrides: [] } : { flags }),
    );
    render(wrap(<AdminFlagsView />));
    fireEvent.click(await screen.findByRole("switch", { name: "Override admin_quota" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Override admin_quota");
    const confirm = screen.getByRole("button", { name: "Xác nhận" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "Bật thử cho đội vận hành" } });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/flags/admin_quota/overrides", expect.objectContaining({ method: "PUT" })),
    );
  });

  it("shows the error state when the catalogue fails", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    render(wrap(<AdminFlagsView />));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được catalogue flag");
  });
});

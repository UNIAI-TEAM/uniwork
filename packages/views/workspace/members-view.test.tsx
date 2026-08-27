import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { MembersView } from "./members-view";

initI18n();

const me = {
  id: "u-me", email: "me@x.com", display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {},
};
const memberRow = (role: string, userId = "u-me") => ({
  workspace_id: "w1", user_id: userId, role, email: `${userId}@x.com`, display_name: userId,
});

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
});

function mockMembership(role: string, source = "membership") {
  requestMock.mockImplementation((...args: unknown[]) => {
    const path = String(args[0] ?? "");
    if (path.endsWith("/me")) {
      return Promise.resolve({ membership: { user_id: "u-me", role, source } });
    }
    if (path.endsWith("/members")) {
      return Promise.resolve({
        members: [
          memberRow(role === "owner" || role === "admin" || role === "member" ? role : "member"),
          memberRow("member", "u-other"),
        ],
      });
    }
    if (path.includes("/invitations")) {
      return Promise.resolve({
        invitations: [
          { id: "1", email: "a@x.com", role: "member", token: "t1" },
          { id: "2", email: "b@x.com", role: "member", token: "t2" },
        ],
        skipped: [],
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe("MembersView", () => {
  it("bulk invites and lists links when the current user is an owner", async () => {
    mockMembership("owner");
    render(wrap(<MembersView workspaceId="w1" />));
    const input = await screen.findByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => "a@x.com, b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await waitFor(() => expect(screen.getByText(/\/invite\/t1/)).toBeInTheDocument());
    expect(screen.getByText(/\/invite\/t2/)).toBeInTheDocument();
  });

  it("hides the invite form from a plain member and says why", async () => {
    mockMembership("member");
    render(wrap(<MembersView workspaceId="w1" />));
    await screen.findByRole("note");
    expect(screen.queryByRole("button", { name: "Mời thành viên" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/chủ sở hữu và quản trị viên/);
  });

  it("lets an org admin without a members row invite and manage others", async () => {
    requestMock.mockImplementation((...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (path.endsWith("/me")) {
        return Promise.resolve({
          membership: { user_id: "u-me", role: "admin", source: "org_admin" },
        });
      }
      if (path.endsWith("/members")) {
        return Promise.resolve({ members: [memberRow("member", "u-other")] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(wrap(<MembersView workspaceId="w1" />));
    await screen.findByRole("button", { name: "Mời thành viên" });
    expect(screen.getByRole("button", { name: "Xóa khỏi workspace" })).toBeInTheDocument();
  });

  it("does not offer remove on the workspace owner", async () => {
    requestMock.mockImplementation((...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (path.endsWith("/me")) {
        return Promise.resolve({
          membership: { user_id: "u-me", role: "admin", source: "membership" },
        });
      }
      if (path.endsWith("/members")) {
        return Promise.resolve({
          members: [memberRow("owner", "u-owner"), memberRow("admin", "u-me")],
        });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(wrap(<MembersView workspaceId="w1" />));
    await screen.findByText("u-owner");
    const removeButtons = screen.queryAllByRole("button", { name: "Xóa khỏi workspace" });
    // Only self (admin) is removable — not the owner row
    expect(removeButtons).toHaveLength(1);
  });
});

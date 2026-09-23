import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { MembersView } from "./members-view";

initI18n();

const me = {
  id: "u-me", email: "me@x.com", display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
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
    if (path.includes("/members/")) return Promise.resolve(undefined);
    if (path.includes("/invitations")) {
      return Promise.resolve({
        invitations: [
          { id: "1", email: "a@x.com", role: "member" },
          { id: "2", email: "b@x.com", role: "member" },
        ],
        skipped: [],
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

describe("MembersView", () => {
  it("bulk invites and lists emailed recipients when the current user is an owner", async () => {
    mockMembership("owner");
    render(wrap(<MembersView workspaceId="w1" />));
    const input = await screen.findByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => "a@x.com, b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await waitFor(() => expect(screen.getByText("a@x.com")).toBeInTheDocument());
    expect(screen.getByText("b@x.com")).toBeInTheDocument();
  });

  it("hides the invite form from a plain member and says why", async () => {
    mockMembership("member");
    render(wrap(<MembersView workspaceId="w1" />));
    await screen.findByRole("note");
    expect(screen.queryByRole("button", { name: "Mời thành viên" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/chủ sở hữu và quản trị viên/);
    // The reason sits under the section it replaces, not loose on the page.
    expect(screen.getByRole("heading", { name: "Mời vào workspace" })).toBeInTheDocument();
  });

  it("says the list failed to load, with a retry, instead of claiming there are no members", async () => {
    let fail = true;
    requestMock.mockImplementation((...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (path.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-me", role: "owner", source: "membership" } });
      if (path.endsWith("/members")) {
        return fail ? Promise.reject(new Error("offline")) : Promise.resolve({ members: [memberRow("owner")] });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    render(wrap(<MembersView workspaceId="w1" />));
    expect(await screen.findByText("Không tải được danh sách thành viên.")).toBeInTheDocument();
    expect(screen.queryByText("Chưa có thành viên nào.")).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("u-me")).toBeInTheDocument();
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
    // Only self (admin) is removable — not the owner row — and leaving lives
    // in the danger zone at the end, not on the reader's own row.
    expect(screen.queryAllByRole("button", { name: "Xóa khỏi workspace" })).toHaveLength(0);
    expect(within(screen.getByRole("list", { name: "Thành viên" })).queryByRole("button", { name: "Rời workspace" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Vùng nguy hiểm" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Rời workspace" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Rời workspace" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Rời workspace này?");
    // The owner's role is translated, never the raw schema value.
    expect(screen.getByText("Chủ sở hữu")).toBeInTheDocument();
    expect(screen.queryByText("owner")).not.toBeInTheDocument();
  });

  it("asks before removing a member and only removes after the confirmation", async () => {
    mockMembership("owner");
    render(wrap(<MembersView workspaceId="w1" />));
    fireEvent.click(await screen.findByRole("button", { name: "Xóa khỏi workspace" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Xóa u-other khỏi workspace?");
    const deletes = () => requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "DELETE");
    expect(deletes()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa khỏi workspace" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(String(deletes()[0]![0])).toContain("/members/u-other");
  });

  it("filters the loaded members by name or email", async () => {
    mockMembership("owner");
    render(wrap(<MembersView workspaceId="w1" />));
    await screen.findByText("u-other");
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm thành viên" }), { target: { value: "OTHER@x" } });
    expect(screen.queryByText("u-me")).not.toBeInTheDocument();
    expect(screen.getByText("u-other")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { MembersView } from "./members-view";

initI18n();

const me = {
  id: "u-me", email: "me@x.com", display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {},
};
const memberRow = (role: string) => ({
  workspace_id: "w1", user_id: "u-me", role, email: "me@x.com", display_name: "Me",
});

beforeEach(() => {
  requestMock.mockReset();
  // The permission hooks read the session user and the member list; seed the
  // session directly so the view does not go through the refresh round-trip.
  setSessionUser(me);
});

describe("MembersView", () => {
  it("bulk invites and lists links when the current user is an owner", async () => {
    requestMock.mockImplementation((...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (path.endsWith("/members")) return Promise.resolve({ members: [memberRow("owner")] });
      return Promise.resolve({
        invitations: [
          { id: "1", email: "a@x.com", role: "member", token: "t1" },
          { id: "2", email: "b@x.com", role: "member", token: "t2" },
        ],
        skipped: [],
      });
    });
    render(wrap(<MembersView workspaceId="w1" />));
    const input = await screen.findByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => "a@x.com, b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await waitFor(() => expect(screen.getByText(/\/invite\/t1/)).toBeInTheDocument());
    expect(screen.getByText(/\/invite\/t2/)).toBeInTheDocument();
  });

  it("hides the invite form from a plain member and says why", async () => {
    requestMock.mockImplementation((...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (path.endsWith("/members")) return Promise.resolve({ members: [memberRow("member")] });
      return Promise.reject(new Error("must not be called"));
    });
    render(wrap(<MembersView workspaceId="w1" />));
    await screen.findByRole("note");
    expect(screen.queryByRole("button", { name: "Mời thành viên" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/chủ sở hữu và quản trị viên/);
  });
});

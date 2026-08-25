import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { MembersView } from "./members-view";

initI18n();
beforeEach(() => requestMock.mockReset());

describe("MembersView", () => {
  it("bulk invites and lists links", async () => {
    requestMock.mockImplementation((...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (path.endsWith("/members")) return Promise.resolve({ members: [] });
      return Promise.resolve({
        invitations: [
          { id: "1", email: "a@x.com", role: "member", token: "t1" },
          { id: "2", email: "b@x.com", role: "member", token: "t2" },
        ],
        skipped: [],
      });
    });
    render(wrap(<MembersView workspaceId="w1" />));
    const input = screen.getByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => "a@x.com, b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Mời thành viên" }));
    await waitFor(() => expect(screen.getByText(/\/invite\/t1/)).toBeInTheDocument());
    expect(screen.getByText(/\/invite\/t2/)).toBeInTheDocument();
  });
});

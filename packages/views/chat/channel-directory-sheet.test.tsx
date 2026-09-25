import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getI18n } from "react-i18next";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { requestMock, wrap } from "../test/api-mock";
import { ChannelDirectorySheet } from "./channel-directory-sheet";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  has_password: true,
};

const t = (key: string, opts?: Record<string, unknown>) => getI18n().t(key, opts);

const room = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "channel",
  name,
  workspace_id: "ws1",
  visibility: "public",
  ...extra,
});

function renderSheet(props: Partial<Parameters<typeof ChannelDirectorySheet>[0]> = {}) {
  return render(
    wrap(
      <ChannelDirectorySheet
        open
        onOpenChange={vi.fn()}
        workspaceId="ws1"
        memberChannelIds={new Set()}
        {...props}
      />,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("ChannelDirectorySheet", () => {
  it("says there is nothing to join yet, and offers to create one when it can", async () => {
    requestMock.mockResolvedValue({ rooms: [] });
    const onCreateChannel = vi.fn();
    renderSheet({ onCreateChannel });

    expect(await screen.findByText(t("chat.channel.directory_none_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("chat.channel.create") }));
    expect(onCreateChannel).toHaveBeenCalled();
    expect(screen.queryByText(t("chat.channel.directory_no_match_hint"))).not.toBeInTheDocument();
  });

  it("tells a search with no match apart from an empty directory", async () => {
    requestMock.mockResolvedValue({ rooms: [] });
    renderSheet();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });

    expect(await screen.findByText(t("chat.channel.directory_no_match_hint"))).toBeInTheDocument();
    expect(screen.queryByText(t("chat.channel.directory_none_title"))).not.toBeInTheDocument();
  });

  it("says a join failed in its own words, not the server's", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.endsWith("/join")) return Promise.reject(new ApiError("Kênh đã bị lưu trữ", "gone", 409));
      return Promise.resolve({ rooms: [room("c1", "marketing"), room("c2", "design")] });
    });
    const onJoined = vi.fn();
    renderSheet({ onJoined, memberChannelIds: new Set(["c2"]) });

    fireEvent.click(await screen.findByRole("button", { name: t("chat.channel.join_named", { name: "marketing" }) }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(t("chat.channel.join_failed", { name: "marketing" })),
    );
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("opens a channel you are already in instead of offering to join it", async () => {
    requestMock.mockResolvedValue({ rooms: [room("c2", "design")] });
    const onJoined = vi.fn();
    renderSheet({ onJoined, memberChannelIds: new Set(["c2"]) });

    fireEvent.click(await screen.findByRole("button", { name: t("chat.channel.open_named", { name: "design" }) }));
    expect(onJoined).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
    expect(screen.queryByRole("button", { name: t("chat.channel.join_named", { name: "design" }) })).toBeNull();
  });

  it("narrows the list accent-insensitively at once and waits for a pause before asking the server", async () => {
    requestMock.mockResolvedValue({ rooms: [room("c1", "Thiết kế"), room("c3", "Kinh doanh")] });
    renderSheet();
    expect(await screen.findByText("Thiết kế")).toBeInTheDocument();
    const callsBefore = requestMock.mock.calls.length;

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "thiet" } });
    expect(await screen.findByText("Thiết kế")).toBeInTheDocument();
    expect(screen.queryByText("Kinh doanh")).toBeNull();
    // No request per keystroke: the server query follows ~250ms later.
    expect(requestMock.mock.calls.length).toBe(callsBefore);
    await waitFor(() => expect(requestMock.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(String(requestMock.mock.calls.at(-1)?.[0])).toContain("thiet");
  });

  it("names its close button", async () => {
    requestMock.mockResolvedValue({ rooms: [] });
    renderSheet();
    expect(await screen.findByRole("button", { name: t("common.close") })).toBeInTheDocument();
  });
});

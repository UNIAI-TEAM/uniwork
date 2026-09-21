import { fireEvent, render, screen } from "@testing-library/react";
import { getI18n } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { requestMock, wrap } from "../test/api-mock";
import { ChatFollowUpsSheet, followUpDue } from "./chat-follow-ups-sheet";

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

const t = (key: string) => getI18n().t(key);

const followUp = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  message_id: `m-${id}`,
  room_kind: "channel",
  room_name: "marketing",
  message_body: `Tin ${id}`,
  ...extra,
});

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("followUpDue", () => {
  const now = new Date(2026, 8, 21, 12, 0);

  it("reads past, later today and later days on the viewer's calendar", () => {
    expect(followUpDue(new Date(2026, 8, 21, 9, 0).toISOString(), now)?.state).toBe("overdue");
    expect(followUpDue(new Date(2026, 8, 21, 17, 0).toISOString(), now)?.state).toBe("today");
    expect(followUpDue(new Date(2026, 8, 23, 9, 0).toISOString(), now)?.state).toBe("upcoming");
    expect(followUpDue(null, now)).toBeNull();
    expect(followUpDue("not a date", now)).toBeNull();
  });
});

describe("ChatFollowUpsSheet", () => {
  it("explains how to add one when the list is empty", async () => {
    requestMock.mockResolvedValue({ follow_ups: [] });
    render(
      wrap(
        <ChatFollowUpsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          onComplete={vi.fn()}
          onConvert={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );
    expect(await screen.findByText(t("chat.follow_up.empty_hint"))).toBeInTheDocument();
  });

  it("marks an overdue item, locks only the busy row and hands delete the record", async () => {
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    requestMock.mockResolvedValue({ follow_ups: [followUp("a", { due_at: past }), followUp("b")] });
    const onDelete = vi.fn();
    render(
      wrap(
        <ChatFollowUpsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          onComplete={vi.fn()}
          onConvert={vi.fn()}
          onDelete={onDelete}
          pendingIds={new Set(["a"])}
        />,
      ),
    );

    await screen.findByText("Tin a");
    const pill = document.querySelector("[data-due-state]");
    expect(pill).toHaveAttribute("data-due-state", "overdue");
    expect(pill?.textContent).not.toContain(past.slice(0, 10));

    const deletes = screen.getAllByRole("button", { name: t("chat.follow_up.delete") });
    expect(deletes[0]).toBeDisabled();
    expect(deletes[1]).toBeEnabled();
    fireEvent.click(deletes[1]!);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "b", message_id: "m-b" }));
  });
});

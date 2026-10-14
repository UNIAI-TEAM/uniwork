import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { ApiError } from "@uniwork/core/api";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AcceptInviteView } from "./accept-invite-view";

initI18n();
beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
});

const me: User = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarded_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const signIn = () => setSessionUser(me);

type Init = { method?: string; body?: unknown };

const beta = { id: "o2", slug: "beta", name: "Beta" };
const acme = { id: "o1", slug: "acme", name: "Acme" };
const betaWorkspace = {
  id: "w2", slug: "ops", name: "Ops", organization_id: "o2", organization_slug: "beta", organization_name: "Beta",
};

function invitation(status = "pending", extra: Record<string, unknown> = {}) {
  return {
    id: "i1",
    status,
    expires_at: "2026-10-20T00:00:00Z",
    organization: beta,
    workspace: { id: "w2", slug: "ops", name: "Ops" },
    org_role: "member",
    inviter_name: "Lan",
    ...extra,
  };
}

function conflict(required_action: string, extra: Record<string, unknown> = {}) {
  return { organization: acme, role: "member", required_action, transfer_candidates_count: 0, ...extra };
}

/**
 * The server as the page sees it: the preview, the caller's organizations
 * (Acme, the one they would leave), Acme's members, and an accept answered by
 * `onAccept`.
 */
function serve({
  preview,
  onAccept = async () => ({ organization: beta, workspace: betaWorkspace }),
}: {
  preview: unknown | (() => Promise<unknown>);
  onAccept?: (body: unknown) => Promise<unknown>;
}) {
  requestMock.mockImplementation(async (path: string, init?: Init) => {
    if (path === "/api/v1/invitations/t1") return typeof preview === "function" ? (preview as () => Promise<unknown>)() : preview;
    if (path === "/api/v1/invitations/t1/accept") return onAccept(init?.body);
    if (path === "/api/v1/orgs") return { organizations: [{ ...acme, role: "member", status: "active" }] };
    if (path === "/api/v1/workspaces") return { workspaces: [] };
    if (path.startsWith("/api/v1/orgs/acme/members")) {
      return {
        members: [
          { user_id: "u1", email: "a@b.co", display_name: "A", role: "owner", created_at: "" },
          { user_id: "u2", email: "an@acme.vn", display_name: "Nguyễn Văn An", role: "admin", created_at: "" },
        ],
      };
    }
    if (path === "/api/v1/me") return { user: me };
    return {};
  });
}

const acceptCalls = () =>
  requestMock.mock.calls.filter(([path]) => String(path).endsWith("/accept")).map(([, init]) => (init as Init | undefined)?.body);

function renderView(onAccepted = vi.fn()) {
  render(wrapWithNav(<AcceptInviteView token="t1" onAccepted={onAccepted} onAnon={() => {}} />));
  return onAccepted;
}

const next = () => fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));

// The member list loads, then the select opens in a portal: slow under a full
// parallel run, so these finds get more than the default second.
const SLOW = { timeout: 5000 };
async function pickHeir() {
  const combobox = await screen.findByRole("combobox", { name: "Chủ sở hữu mới" }, SLOW);
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name: "Nguyễn Văn An an@acme.vn" }, SLOW);
  // A bare click on an option counts only if Base UI has highlighted it by
  // then (a timing race); a click that starts with a pointer down on the
  // item is a real press and always commits.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
  await waitFor(() => expect(combobox).toHaveTextContent("Nguyễn Văn An"));
}

describe("AcceptInviteView", () => {
  it("sends a signed-out visitor to login without reading or accepting the invitation", async () => {
    // Phiên chưa xác định khi mount, nên chờ nó ngã ngũ thành anon.
    requestMock.mockResolvedValue(null);
    const onAnon = vi.fn();
    render(wrapWithNav(<AcceptInviteView token="t1" onAccepted={() => {}} onAnon={onAnon} />));
    await waitFor(() => expect(onAnon).toHaveBeenCalled());
    expect(requestMock.mock.calls.some(([path]) => String(path).includes("/invitations/"))).toBe(false);
  });

  describe("when the invitation cannot be read", () => {
    /**
     * Bản cũ đổ thẳng `message` của server ra trang: người dùng Việt nhận đúng hai
     * chữ "not found" trên nền trắng, không tiêu đề và không lối đi tiếp.
     */
    it("translates a dead link, announces it and offers a way forward", async () => {
      signIn();
      serve({ preview: () => Promise.reject(new ApiError("not found", "not_found", 404)) });
      renderView();
      const heading = await screen.findByRole("heading", { name: "Không dùng được lời mời này" });
      expect(screen.queryByText("not found")).not.toBeInTheDocument();
      // The page keeps one shell, so the new title moves focus to it: that announces the refusal.
      await waitFor(() => expect(heading).toHaveFocus());
      // The focus it took is visible to a keyboard user: the global
      // :focus-visible outline is not switched off on the heading, and a name
      // with no break opportunity wraps instead of overflowing the card.
      expect(heading).not.toHaveClass("outline-none");
      expect(heading).toHaveClass("[overflow-wrap:anywhere]");
      expect(screen.getByRole("link", { name: "Xem workspace của tôi" })).toHaveAttribute("href", "/workspaces");
    });

    /** Mã lạ không được lộ chuỗi tiếng Anh của server ra màn hình. */
    it("falls back to a generic sentence for an unmapped code or a drifted response", async () => {
      signIn();
      serve({ preview: () => Promise.reject(new ApiError("internal explosion", "boom", 500)) });
      renderView();
      expect(await screen.findByText("Chúng tôi chưa xử lý được lời mời này.")).toBeInTheDocument();
      expect(screen.queryByText("internal explosion")).not.toBeInTheDocument();
    });

    it("reads a malformed preview as a failure rather than guessing a state", async () => {
      signIn();
      serve({ preview: { invitation: { id: 1 } } });
      renderView();
      expect(await screen.findByText("Chúng tôi chưa xử lý được lời mời này.")).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);
    });

    it("explains a wrong-account invite and offers to switch account", async () => {
      signIn();
      serve({ preview: () => Promise.reject(new ApiError("x", "invitation_email_mismatch", 403)) });
      renderView();
      expect(await screen.findByText("Lời mời này gửi tới một email khác với tài khoản bạn đang đăng nhập.")).toBeInTheDocument();
      expect(screen.getByText("Đăng nhập bằng email đã nhận lời mời rồi mở lại link.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dùng tài khoản khác" })).toBeInTheDocument();
    });

    it("says an organization waiting out its deletion takes nobody new", async () => {
      signIn();
      serve({ preview: () => Promise.reject(new ApiError("x", "organization_deletion_scheduled", 403)) });
      renderView();
      expect(await screen.findByText("Tổ chức này đang chờ xóa nên không nhận thêm thành viên.")).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);
    });

    it("lets the person try again after too many attempts", async () => {
      signIn();
      let reads = 0;
      serve({
        preview: () => {
          reads += 1;
          return reads === 1
            ? Promise.reject(new ApiError("slow down", "rate_limited", 429))
            : Promise.resolve({ invitation: invitation(), conflicts: [] });
        },
      });
      renderView();
      expect(await screen.findByText("Bạn thử quá nhiều lần. Chờ một lát rồi mở lại link.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
      expect(await screen.findByRole("heading", { name: "Tham gia Beta" })).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);
    });

    it("sends an unverified account to verify its email first", async () => {
      signIn();
      serve({ preview: () => Promise.reject(new ApiError("x", "email_unverified", 403)) });
      renderView();
      expect(await screen.findByText("Bạn cần xác minh email trước khi nhận lời mời.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Xác minh email" })).toHaveAttribute("href", "/verify");
    });
  });

  describe("an invitation that no longer admits anybody", () => {
    it.each([
      ["expired", "Lời mời đã hết hạn."],
      ["revoked", "Lời mời đã bị thu hồi."],
    ])("says the invitation is %s and that the person is still where they were", async (status, sentence) => {
      signIn();
      serve({ preview: { invitation: invitation(status), conflicts: [] } });
      renderView();
      expect(await screen.findByRole("heading", { name: "Lời mời không còn hiệu lực" })).toBeInTheDocument();
      expect(screen.getByText(sentence)).toBeInTheDocument();
      // The news, in the success tone, said politely once the organizations load.
      expect(await screen.findByRole("status")).toHaveTextContent("Bạn vẫn ở Acme, không có gì thay đổi.");
      // What to do about the dead link is a hint on the page, not an announcement.
      expect(screen.getByRole("note")).toHaveTextContent(/nhờ (người mời|họ) gửi/i);
      // Other invitations may still be waiting.
      expect(screen.getByRole("link", { name: "Xem lời mời của tôi" })).toHaveAttribute("href", "/invitations");
      expect(acceptCalls()).toHaveLength(0);
    });

    /** An accepted invitation: the accept is idempotent for whoever it admitted, and joins nobody else. */
    it("takes the member it admitted into the organization", async () => {
      signIn();
      serve({ preview: { invitation: invitation("accepted"), conflicts: [] } });
      const onAccepted = renderView();
      await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" })));
      expect(acceptCalls()).toEqual([undefined]);
    });

    /** The repeat ask failed in passing: "Thử lại" asks again instead of spinning on "accepted". */
    it("asks again after a failed repeat accept when the person retries", async () => {
      signIn();
      let calls = 0;
      serve({
        preview: { invitation: invitation("accepted"), conflicts: [] },
        onAccept: async () => {
          calls += 1;
          if (calls === 1) throw new ApiError("boom", "internal", 500);
          return { organization: beta, workspace: betaWorkspace };
        },
      });
      const onAccepted = renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" })));
      expect(acceptCalls()).toHaveLength(2);
    });

    it("offers a retry instead of a spinner when the repeat accept meets another change", async () => {
      signIn();
      let calls = 0;
      serve({
        preview: { invitation: invitation("accepted"), conflicts: [] },
        onAccept: async () => {
          calls += 1;
          if (calls === 1) throw new ApiError("x", "membership_busy", 409);
          return { organization: beta, workspace: betaWorkspace };
        },
      });
      const onAccepted = renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    });

    it("tells anybody else the invitation was already used", async () => {
      signIn();
      serve({
        preview: { invitation: invitation("accepted"), conflicts: [] },
        onAccept: () => Promise.reject(new ApiError("gone", "invitation_accepted", 410)),
      });
      const onAccepted = renderView();
      expect(await screen.findByText("Lời mời đã được dùng.")).toBeInTheDocument();
      expect(onAccepted).not.toHaveBeenCalled();
    });
  });

  describe("a pending invitation with nothing in the way", () => {
    it("shows the invitation and accepts nothing until asked", async () => {
      signIn();
      serve({ preview: { invitation: invitation(), conflicts: [] } });
      renderView();
      expect(await screen.findByRole("heading", { name: "Tham gia Beta" })).toBeInTheDocument();
      expect(screen.getByText("Lan mời bạn tham gia tổ chức này.")).toBeInTheDocument();
      // The organization leads the card as its identity; the list holds the facts.
      expect(screen.getByText("Beta")).toBeInTheDocument();
      const details = screen.getByRole("list", { name: "Tham gia Beta" });
      expect(within(details).getByText("Ops")).toBeInTheDocument();
      expect(within(details).getByText("Thành viên")).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);
    });

    it("joins with an empty body and hands over the workspace", async () => {
      signIn();
      serve({ preview: { invitation: invitation(), conflicts: [] } });
      const onAccepted = renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Tham gia" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" })));
      expect(acceptCalls()).toEqual([undefined]);
    });

    /**
     * The accept drops the cache and reads /me again before the page learns it
     * succeeded; the preview read again in that window says "accepted", which
     * must not send the accept a second time.
     */
    it("accepts once even when the preview reads the invitation as accepted afterwards", async () => {
      signIn();
      serve({
        preview: async () => ({ invitation: invitation(acceptCalls().length > 0 ? "accepted" : "pending"), conflicts: [] }),
      });
      const onAccepted = renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Tham gia" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
      // Let any refetch the accept set off settle before counting.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(acceptCalls()).toEqual([undefined]);
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });

    it("offers no way to put the join off once it is being sent", async () => {
      signIn();
      serve({ preview: { invitation: invitation(), conflicts: [] }, onAccept: () => new Promise(() => {}) });
      renderView();
      expect(await screen.findByRole("link", { name: "Để sau" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
      await waitFor(() => expect(screen.queryByRole("link", { name: "Để sau" })).not.toBeInTheDocument());
    });

    it("says an organization-level invitation lands in no workspace yet", async () => {
      signIn();
      const { workspace: _ws, inviter_name: _name, ...orgLevel } = invitation();
      serve({ preview: { invitation: orgLevel, conflicts: [] }, onAccept: async () => ({ organization: beta }) });
      const onAccepted = renderView();
      expect(await screen.findByText("Chưa vào workspace nào. Bạn chọn workspace sau khi tham gia.")).toBeInTheDocument();
      expect(screen.getByText("Bạn được mời tham gia tổ chức này.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(null));
    });

    it("lets the person put it off without accepting", async () => {
      signIn();
      serve({ preview: { invitation: invitation(), conflicts: [] } });
      renderView();
      const later = await screen.findByRole("link", { name: "Để sau" });
      // Acme has no workspace here, so home is where its organization starts.
      await waitFor(() => expect(later).toHaveAttribute("href", "/workspaces/new"));
      fireEvent.click(later);
      expect(acceptCalls()).toHaveLength(0);
    });

    it("moves into the switch when the person joined another organization meanwhile", async () => {
      signIn();
      serve({
        preview: { invitation: invitation(), conflicts: [] },
        onAccept: () =>
          Promise.reject(
            new ApiError("x", "organization_switch_required", 409, undefined, { conflicts: [conflict("leave")] }),
          ),
      });
      renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Tham gia" }));
      expect(await screen.findByRole("heading", { name: "Bạn đang thuộc Acme" })).toBeInTheDocument();
      // A status, not an alert: the step heading takes focus at the same
      // moment, and an alert would cut its announcement off.
      expect(screen.getByRole("status")).toHaveTextContent(
        "Tình hình đã thay đổi trong lúc bạn thao tác. Xem lại từng mục dưới đây.",
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("keeps the person on the page when the server is busy with another change", async () => {
      signIn();
      serve({
        preview: { invitation: invitation(), conflicts: [] },
        onAccept: () => Promise.reject(new ApiError("x", "membership_busy", 409)),
      });
      renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Tham gia" }));
      // Nothing failed: a status in the warning tone, beside the button that tries again.
      expect(await screen.findByRole("status")).toHaveTextContent("Đang có một thay đổi khác với tài khoản của bạn.");
      expect(screen.getByRole("button", { name: "Tham gia" })).toBeInTheDocument();
    });

    it("shows a refusal of the organization itself as the error screen", async () => {
      signIn();
      serve({
        preview: { invitation: invitation(), conflicts: [] },
        onAccept: () => Promise.reject(new ApiError("x", "organization_suspended", 403)),
      });
      renderView();
      fireEvent.click(await screen.findByRole("button", { name: "Tham gia" }));
      expect(await screen.findByText("Tổ chức này đang tạm ngưng hoạt động.")).toBeInTheDocument();
    });
  });

  describe("switching organization", () => {
    async function openWizard(conflicts: unknown[], onAccept?: (body: unknown) => Promise<unknown>) {
      signIn();
      serve({ preview: { invitation: invitation(), conflicts }, onAccept });
      const onAccepted = renderView();
      expect(await screen.findByRole("heading", { name: "Chuyển sang Beta" })).toBeInTheDocument();
      return onAccepted;
    }

    it("opens on the conflict and says what the person loses", async () => {
      await openWizard([conflict("leave", { role: "admin" })]);
      expect(screen.getByRole("heading", { name: "Bạn đang thuộc Acme" })).toBeInTheDocument();
      // From Acme, as an admin, to Beta, as a member: one route, top to bottom.
      const route = screen.getByRole("list", { name: "Chuyển từ Acme sang Beta" });
      const [from, to] = within(route).getAllByRole("listitem");
      expect(from).toHaveTextContent("Acme");
      expect(within(from!).getByText("Vai trò: Quản trị")).toBeInTheDocument();
      expect(to).toHaveTextContent("Beta");
      expect(within(to!).getByText("Vai trò: Thành viên")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Bạn sẽ không còn vào được Acme" })).toBeInTheDocument();
      const progress = screen.getByRole("group", { name: "Các bước chuyển tổ chức" });
      // Progress, not navigation: no landmark, and no aria-orientation (not allowed on group).
      expect(progress).not.toHaveAttribute("aria-orientation");
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(acceptCalls()).toHaveLength(0);
    });

    it("leaves: confirm, review, switch in one request", async () => {
      const onAccepted = await openWizard([conflict("leave")]);
      next();
      const heading = await screen.findByRole("heading", { name: "Xử lý tổ chức cũ" });
      // Focus follows the step, so a screen reader hears where it landed, and
      // the global :focus-visible outline shows a keyboard user the same.
      await waitFor(() => expect(heading).toHaveFocus());
      expect(heading).not.toHaveClass("outline-none");
      const cont = screen.getByRole("button", { name: "Tiếp tục" });
      expect(cont).toHaveAttribute("aria-disabled", "true");
      next();
      expect(screen.getByRole("heading", { name: "Xử lý tổ chức cũ" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("checkbox", { name: "Tôi muốn rời Acme" }));
      expect(cont).not.toHaveAttribute("aria-disabled");
      next();
      expect(await screen.findByRole("heading", { name: "Xác nhận chuyển tổ chức" })).toBeInTheDocument();
      expect(screen.getByText("Rời Acme")).toBeInTheDocument();
      expect(screen.getByText("Tham gia Beta với vai trò Thành viên")).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Beta" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({ id: "w2" })));
      expect(acceptCalls()).toEqual([{ resolve: [{ organization_id: "o1", action: "leave" }] }]);
    });

    it("can go back a step without losing what was filled in", async () => {
      await openWizard([conflict("leave")]);
      next();
      fireEvent.click(await screen.findByRole("checkbox", { name: "Tôi muốn rời Acme" }));
      next();
      const back = await screen.findByRole("button", { name: "Quay lại" });
      // Back sits above the heading and before it in the DOM, so Shift+Tab
      // from the focused heading reaches it and reading order matches layout.
      const heading = screen.getByRole("heading", { name: "Xác nhận chuyển tổ chức" });
      expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(back);
      expect(await screen.findByRole("checkbox", { name: "Tôi muốn rời Acme" })).toBeChecked();
    });

    it("lets Enter move a step on once it is complete, and do nothing before", async () => {
      await openWizard([conflict("transfer", { role: "owner", transfer_candidates_count: 1 })]);
      next();
      await pickHeir();
      const password = screen.getByLabelText("Mật khẩu hiện tại của bạn") as HTMLInputElement;
      const cont = screen.getByRole("button", { name: "Tiếp tục" });
      // The step is a form, so Enter in the password field submits it and a
      // password manager sees a sign-in-like form.
      expect(password.form).not.toBeNull();
      expect(cont).toHaveAttribute("type", "submit");
      expect((cont as HTMLButtonElement).form).toBe(password.form);
      fireEvent.submit(password.form!);
      expect(screen.getByRole("heading", { name: "Xử lý tổ chức cũ" })).toBeInTheDocument();
      fireEvent.change(password, { target: { value: "secret" } });
      fireEvent.submit(password.form!);
      expect(await screen.findByRole("heading", { name: "Xác nhận chuyển tổ chức" })).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);
      const action = screen.getByRole("button", { name: "Chuyển sang Beta" }) as HTMLButtonElement;
      expect(action).toHaveAttribute("type", "submit");
      fireEvent.submit(action.form!);
      await waitFor(() => expect(acceptCalls()).toHaveLength(1));
    });

    it("transfers ownership to the chosen member with the owner's password", async () => {
      const onAccepted = await openWizard([conflict("transfer", { role: "owner", transfer_candidates_count: 1 })]);
      next();
      expect(await screen.findByText(/Bạn là chủ sở hữu của Acme/)).toBeInTheDocument();
      const cont = screen.getByRole("button", { name: "Tiếp tục" });
      await pickHeir();
      expect(cont).toHaveAttribute("aria-disabled", "true");
      fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "secret" } });
      expect(cont).not.toHaveAttribute("aria-disabled");
      next();
      expect(await screen.findByText("Chuyển quyền sở hữu Acme cho Nguyễn Văn An, rồi rời tổ chức")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Beta" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
      expect(acceptCalls()).toEqual([
        { resolve: [{ organization_id: "o1", action: "transfer", transfer_to_user_id: "u2", password: "secret" }] },
      ]);
    });

    it("closes the organization once its slug is typed back exactly", async () => {
      const onAccepted = await openWizard([conflict("close", { role: "owner" })]);
      next();
      expect(await screen.findByText(/Bạn là thành viên duy nhất của Acme/)).toBeInTheDocument();
      expect(screen.getByText(/Acme sẽ được lưu trữ/)).toBeInTheDocument();
      const field = screen.getByLabelText("Gõ đường dẫn tổ chức để xác nhận");
      // Slugs are lowercase: a phone keyboard must not capitalise or correct them.
      expect(field).toHaveAttribute("autocapitalize", "none");
      expect(field).toHaveAttribute("autocorrect", "off");
      fireEvent.change(field, { target: { value: "Acme" } });
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toHaveAttribute("aria-disabled", "true");
      fireEvent.change(field, { target: { value: "acme" } });
      next();
      expect(await screen.findByText("Đóng Acme")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Beta" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
      expect(acceptCalls()).toEqual([{ resolve: [{ organization_id: "o1", action: "close", confirm_slug: "acme" }] }]);
    });

    it("stops at a suspended organization the person owns, and says who can help", async () => {
      await openWizard([
        conflict("blocked", { role: "owner", blocked_reason: "owner_of_suspended_organization" }),
      ]);
      next();
      expect(await screen.findByText(/Acme đang tạm ngưng/)).toBeInTheDocument();
      // Part of the step the heading announced: a note, not an alert.
      expect(screen.getByRole("note")).toHaveTextContent(/Acme đang tạm ngưng/);
      const cont = screen.getByRole("button", { name: "Tiếp tục" });
      // aria-disabled, not disabled: it stays reachable and says why.
      expect(cont).toHaveAttribute("aria-disabled", "true");
      expect(cont).not.toBeDisabled();
      expect(cont).toHaveAccessibleDescription("Chưa thể tiếp tục khi còn tổ chức đang tạm ngưng.");
      next();
      expect(screen.queryByRole("heading", { name: "Xác nhận chuyển tổ chức" })).not.toBeInTheDocument();
    });

    it("lets the person put the switch off at any step", async () => {
      await openWizard([conflict("leave")]);
      next();
      expect(await screen.findByRole("link", { name: "Để sau" })).toBeInTheDocument();
      expect(acceptCalls()).toHaveLength(0);
    });

    async function reachConfirm(conflicts: unknown[], onAccept: (body: unknown) => Promise<unknown>) {
      const onAccepted = await openWizard(conflicts, onAccept);
      next();
      fireEvent.click(await screen.findByRole("checkbox", { name: "Tôi muốn rời Acme" }));
      next();
      fireEvent.click(await screen.findByRole("button", { name: "Chuyển sang Beta" }));
      return onAccepted;
    }

    /** The old organization changed under the wizard: the fresh conflicts replace the old ones. */
    it("goes back to the organization step with the fresh conflicts when the situation changed", async () => {
      await reachConfirm([conflict("leave")], () =>
        Promise.reject(
          new ApiError("x", "organization_switch_required", 409, undefined, {
            conflicts: [conflict("close", { role: "owner" })],
          }),
        ),
      );
      expect(await screen.findByText("Tình hình đã thay đổi trong lúc bạn thao tác. Xem lại từng mục dưới đây.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Xử lý tổ chức cũ" })).toBeInTheDocument();
      expect(screen.getByLabelText("Gõ đường dẫn tổ chức để xác nhận")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: "Tôi muốn rời Acme" })).not.toBeInTheDocument();
    });

    it("falls back to the plain invitation when nothing stands in the way any more", async () => {
      await reachConfirm([conflict("leave")], () =>
        Promise.reject(new ApiError("x", "organization_switch_required", 409, undefined, { conflicts: [] })),
      );
      expect(await screen.findByRole("heading", { name: "Tham gia Beta" })).toBeInTheDocument();
      expect(screen.getByText("Tình hình đã thay đổi trong lúc bạn thao tác. Xem lại từng mục dưới đây.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tham gia" })).toBeInTheDocument();
    });

    it("tells the person the invitation died mid-switch and that they are still in Acme", async () => {
      const onAccepted = await reachConfirm([conflict("leave")], () =>
        Promise.reject(new ApiError("x", "invitation_revoked", 410)),
      );
      expect(await screen.findByRole("heading", { name: "Lời mời không còn hiệu lực" })).toBeInTheDocument();
      expect(screen.getByText("Lời mời đã bị thu hồi.")).toBeInTheDocument();
      expect(await screen.findByText("Bạn vẫn ở Acme, không có gì thay đổi.")).toBeInTheDocument();
      expect(onAccepted).not.toHaveBeenCalled();
    });

    it("stays on the confirmation and asks for a retry when the server is busy", async () => {
      let calls = 0;
      const onAccepted = await reachConfirm([conflict("leave")], async () => {
        calls += 1;
        if (calls === 1) throw new ApiError("x", "membership_busy", 409);
        return { organization: beta, workspace: betaWorkspace };
      });
      expect(await screen.findByRole("status")).toHaveTextContent("Thử lại sau giây lát.");
      fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Beta" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    });

    /** A network or server failure leaves the choices made; the same button sends them again. */
    it("keeps the confirmation and what was chosen when the switch fails in passing", async () => {
      let calls = 0;
      const onAccepted = await reachConfirm([conflict("leave")], async () => {
        calls += 1;
        if (calls === 1) throw new ApiError("boom", "internal", 502);
        return { organization: beta, workspace: betaWorkspace };
      });
      expect(await screen.findByRole("status")).toHaveTextContent("Chưa gửi được yêu cầu chuyển tổ chức.");
      fireEvent.click(screen.getByRole("button", { name: "Chuyển sang Beta" }));
      await waitFor(() => expect(onAccepted).toHaveBeenCalled());
      const calls2 = acceptCalls();
      expect(calls2).toHaveLength(2);
      expect(calls2[1]).toEqual(calls2[0]);
    });

    /** Once sent, the switch cannot be called off: "Để sau" would only hide that it went through. */
    it("offers no way to put the switch off once it is being sent", async () => {
      await reachConfirm([conflict("leave")], () => new Promise(() => {}));
      await waitFor(() => expect(screen.queryByRole("link", { name: "Để sau" })).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Quay lại" })).not.toBeInTheDocument();
    });

    /**
     * An account that signs in only with Google has no password, and the
     * transfer is confirmed with one: the wizard says so instead of asking
     * for a password the account does not have.
     */
    it("tells an owner without a password that the transfer cannot be confirmed here", async () => {
      setSessionUser({ ...me, has_password: false });
      serve({ preview: { invitation: invitation(), conflicts: [conflict("transfer", { role: "owner", transfer_candidates_count: 1 })] } });
      renderView();
      expect(await screen.findByRole("heading", { name: "Chuyển sang Beta" })).toBeInTheDocument();
      next();
      expect(await screen.findByText(/tài khoản của bạn chưa có mật khẩu/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Mật khẩu hiện tại của bạn")).not.toBeInTheDocument();
      await pickHeir();
      const cont = screen.getByRole("button", { name: "Tiếp tục" });
      expect(cont).toHaveAttribute("aria-disabled", "true");
      expect(cont).toHaveAccessibleDescription("Chưa thể tiếp tục khi tài khoản chưa có mật khẩu.");
    });

    it("says the account has no password when the server refuses the transfer for that", async () => {
      await openWizard([conflict("transfer", { role: "owner", transfer_candidates_count: 1 })], () =>
        Promise.reject(new ApiError("x", "password_required", 403)),
      );
      next();
      await pickHeir();
      fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "anything" } });
      next();
      // Found outside act: a find polled inside act waits on updates act holds back.
      const action = await screen.findByRole("button", { name: "Chuyển sang Beta" }, SLOW);
      await act(async () => {
        fireEvent.click(action);
      });
      expect(await screen.findByText(/tài khoản của bạn chưa có mật khẩu/, {}, SLOW)).toBeInTheDocument();
      expect(screen.queryByLabelText("Mật khẩu hiện tại của bạn")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tiếp tục" })).toHaveAttribute("aria-disabled", "true");
      // Sent back to the step, a screen reader also hears why.
      await waitFor(() =>
        expect(
          screen
            .getAllByText("Chưa thể tiếp tục khi tài khoản chưa có mật khẩu.")
            .some((el) => el.closest('[aria-live="polite"]') !== null),
        ).toBe(true),
      );
    });

    it("sends the owner back to the password when the server refuses it", async () => {
      await openWizard([conflict("transfer", { role: "owner", transfer_candidates_count: 1 })], () =>
        Promise.reject(new ApiError("x", "invalid_credentials", 401)),
      );
      next();
      await pickHeir();
      fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại của bạn"), { target: { value: "wrong" } });
      next();
      // Found outside act: a find polled inside act waits on updates act holds back.
      const action = await screen.findByRole("button", { name: "Chuyển sang Beta" }, SLOW);
      await act(async () => {
        fireEvent.click(action);
      });
      const password = await screen.findByLabelText("Mật khẩu hiện tại của bạn", {}, SLOW);
      expect(password).toHaveValue("");
      expect(password).toHaveAttribute("aria-invalid", "true");
      expect(password).toHaveAccessibleDescription("Mật khẩu chưa đúng. Nhập lại để chuyển quyền sở hữu.");
      // Focus lands on the refused field, whose description says why, not on the step heading.
      await waitFor(() => expect(password).toHaveFocus());
    });
  });
});

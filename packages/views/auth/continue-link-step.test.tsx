import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { ContinueView } from "./continue-view";

initI18n();

/**
 * The link step (/auth/continue?step=link, spec §4.3): signed in, it asks
 * once and writes only on "Liên kết"; success is said, never navigated past
 * by itself; every failure keeps a way on.
 */
const NEXT = "/invite/t1";
const TICKET = { provider: "google", kind: "unmatched", email: "an@gmail.com", name: "An Nguyễn", private_relay: false };
const USER = {
  id: "u1", email: "an@company.vn", display_name: "An", onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const METHODS = {
  password: { set: true, changed_at: null },
  google: { linked: true, email: "an@gmail.com", linked_at: null },
  apple: { linked: false, email: null, linked_at: null, private_relay: false },
  account_email_is_relay: false,
  proofs: ["password", "email_code"],
};
const LINK_STEP = `/auth/continue?step=link&next=${encodeURIComponent(NEXT)}`;

type Answer = unknown | ((body: unknown) => unknown);
function route(map: Record<string, Answer>) {
  requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    const key = `${opts?.method ?? "GET"} ${path}`;
    if (!(key in map)) throw new Error(`unexpected ${key}`);
    const answer = map[key];
    return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
  });
}
const linkCalls = () => requestMock.mock.calls.filter(([path]) => path === "/api/v1/auth/sign-in-ticket/link");
const refusal = (code: string, status: number, fields?: Record<string, unknown>) => () =>
  Promise.reject(new ApiError(code, code, status, undefined, fields));

function open(nav = fakeNav(LINK_STEP)) {
  const onDone = vi.fn();
  render(wrapWithNav(<ContinueView next={NEXT} step="link" onDone={onDone} />, nav));
  return { nav, onDone };
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(USER);
});

describe("ContinueLinkStep", () => {
  it("asks before it writes anything", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET });
    open();
    expect(await screen.findByRole("heading", { name: "Liên kết Google" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Tài khoản Google" }).querySelector('[data-slot="identity-linked"]')).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Liên kết Google (an@gmail.com) với an@company.vn?");
    expect(screen.getByRole("button", { name: "Liên kết" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Không liên kết" })).toBeInTheDocument();
    expect(linkCalls()).toHaveLength(0);
  });

  it("says it is linked and waits on a focused Tiếp tục", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "POST /api/v1/auth/sign-in-ticket/link": { user: USER, sign_in_methods: METHODS } });
    const { onDone } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết" }));
    const status = screen.getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Đã liên kết Google. Lần sau chỉ cần Google."));
    // The identity is sealed with a check for the eye; the sentence carries it for the ear.
    const identity = screen.getByRole("group", { name: "Tài khoản Google" });
    expect(identity.querySelector('[data-slot="identity-linked"]')).toHaveAttribute("aria-hidden", "true");
    expect(linkCalls()[0]![1]).toMatchObject({ method: "POST", body: {} });
    const next = screen.getByRole("button", { name: "Tiếp tục" });
    expect(next).toHaveFocus();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(next);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }));
  });

  it("reads a reload after it is done as done", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": () => Promise.reject(new ApiError("gone", "sign_in_ticket_missing", 404)) });
    const { onDone } = open();
    expect(await screen.findByRole("heading", { name: "Đã xong" })).toBeInTheDocument();
    expect(screen.getByText("Không còn gì để liên kết. Tiếp tục vào UniWork.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("asks to move it off an empty account, then sends move", async () => {
    let first = true;
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/link": (body: unknown) => {
        if (first) {
          first = false;
          return refusal("sign_in_method_movable", 409, { masked_email: "a•••@gmail.com" })();
        }
        expect(body).toEqual({ move: true });
        return { user: USER, sign_in_methods: METHODS };
      },
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết" }));
    const question = await screen.findByRole("group", { name: "Chuyển Google sang tài khoản này?" });
    expect(question).toHaveFocus();
    // One question on screen: the line under the title says which account "this account" is.
    expect(screen.getByRole("status")).toHaveTextContent("Bạn đang đăng nhập an@company.vn.");
    expect(question).toHaveTextContent("Tài khoản Google này đang được dùng cho tài khoản trống a•••@gmail.com.");
    // The heading asks; the sentence under it only says what is true.
    expect(question.textContent?.match(/sang tài khoản này\?/g)).toHaveLength(1);
    expect(question).toHaveTextContent("Tài khoản trống đó chưa từng vào tổ chức nào và sẽ bị xóa.");
    // Settings' pair for the same decision.
    expect(screen.getByRole("button", { name: "Không chuyển" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chuyển sang đây" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã liên kết Google."));
    expect(linkCalls()).toHaveLength(2);
  });

  it("names who holds it when it is taken, and only goes on", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/link": refusal("sign_in_method_taken", 409, { masked_email: "b•••@acme.vn" }),
    });
    open();
    const press = await screen.findByRole("button", { name: "Liên kết" });
    press.focus();
    fireEvent.click(press);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tài khoản Google này đang được dùng cho b•••@acme.vn. Đăng nhập vào đó và gỡ liên kết trước.",
    );
    expect(screen.queryByRole("button", { name: "Liên kết" })).toBeNull();
    // The button pressed is gone: focus is on what is left, not on <body>,
    // and the question it would have answered is no longer asked.
    await waitFor(() => expect(screen.getByRole("button", { name: "Tiếp tục" })).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Chưa liên kết Google với an@company.vn.");
  });

  it("asks an older session to confirm it is the person, then links", async () => {
    let links = 0;
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/me/step-up": { step_up_token: "sut-1", expires_at: new Date(Date.now() + 600_000).toISOString(), method: "password" },
      "POST /api/v1/auth/sign-in-ticket/link": () => {
        links += 1;
        return links === 1
          ? Promise.reject(new ApiError("proof", "proof_required", 403, undefined, { proofs: ["password", "email_code"] }))
          : { user: USER, sign_in_methods: METHODS };
      },
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
    expect(dialog.getByText("Để bảo vệ tài khoản, xác nhận là bạn trước khi liên kết Google.")).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText("Mật khẩu hiện tại"), { target: { value: "password123" } });
    fireEvent.click(dialog.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã liên kết Google. Lần sau chỉ cần Google."));
    expect(linkCalls()[1]![1]).toMatchObject({ body: { step_up_token: "sut-1" } });
  });

  it("leaves the question as it was when the proof dialog is closed", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/link": refusal("proof_required", 403, { proofs: ["password"] }),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Xác nhận là bạn" }));
    fireEvent.click(dialog.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Liên kết" })).toBeInTheDocument();
    expect(linkCalls()).toHaveLength(1);
  });

  it("sends an ended session to one more sign-in that links", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      // invalid_token reads as an ended session whatever the status; a 401
      // would first go through the transport's refresh, which this test is not about.
      "POST /api/v1/auth/sign-in-ticket/link": refusal("invalid_token", 400),
    });
    open();
    const press = await screen.findByRole("button", { name: "Liên kết" });
    press.focus();
    fireEvent.click(press);
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("link", { name: "Đăng nhập để liên kết" })).toHaveFocus());
    expect(screen.getByRole("link", { name: "Đăng nhập để liên kết" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(LINK_STEP)}&link=1`,
    );
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeInTheDocument();
  });

  it("keeps Liên kết as the retry after a dropped connection, with Tiếp tục beside it", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "POST /api/v1/auth/sign-in-ticket/link": () => Promise.reject(new TypeError("offline")) });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kết nối được. Kiểm tra mạng rồi thử lại.");
    expect(screen.getByRole("button", { name: "Liên kết" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiếp tục" })).toBeInTheDocument();
  });

  it("drops the pending sign-in on Không liên kết and goes on", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "DELETE /api/v1/auth/sign-in-ticket": undefined });
    const { onDone } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Không liên kết" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" })));
    expect(linkCalls()).toHaveLength(0);
  });

  it("sends a signed-out browser to the sign-in that links, and back here", async () => {
    resetAuthStoreForTests();
    useAuthStore.setState({ user: null, status: "anon" });
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET });
    const { nav } = open();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(LINK_STEP)}&link=1`));
  });
});

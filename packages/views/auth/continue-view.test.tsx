import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import type { NavigationAdapter } from "../navigation";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { ContinueView } from "./continue-view";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

initI18n();

/**
 * The choice screen (spec §4.3), every state: the transport is mocked per
 * route so the real schemas and the one error table stay in the loop.
 */
const NEXT = "/invite/t1";
const TICKET = { provider: "google", kind: "unmatched", email: "an@gmail.com", name: "An Nguyễn", private_relay: false };
const RELAY = { provider: "apple", kind: "unmatched", email: "x7@privaterelay.appleid.com", name: "", private_relay: true };
const USER = {
  id: "u1", email: "an@company.vn", display_name: "An", onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const SESSION = { access_token: "tok", user: USER };
const MISSING = () => new ApiError("gone", "sign_in_ticket_missing", 404);

type Answer = unknown | ((body: unknown) => unknown);
let answers: Record<string, Answer> = {};
function route(map: Record<string, Answer>) {
  answers = map;
  requestMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    const key = `${opts?.method ?? "GET"} ${path}`;
    if (!(key in answers)) throw new Error(`unexpected ${key}`);
    const answer = answers[key];
    return typeof answer === "function" ? (answer as (body: unknown) => unknown)(opts?.body) : answer;
  });
}
const calls = (key: string) =>
  requestMock.mock.calls.filter(([path, opts]) => `${(opts as { method?: string } | undefined)?.method ?? "GET"} ${path}` === key);

function signedOut() {
  useAuthStore.setState({ user: null, status: "anon" });
}

function open(props: { step?: "link" | null; nav?: NavigationAdapter; onDone?: (user: unknown) => void } = {}) {
  const nav = props.nav ?? fakeNav(`/auth/continue?next=${encodeURIComponent(NEXT)}`);
  const onDone = props.onDone ?? vi.fn();
  render(wrapWithNav(<ContinueView next={NEXT} step={props.step ?? null} onDone={onDone} />, nav));
  return { nav, onDone };
}

const LINK_STEP = `/auth/continue?step=link&next=${encodeURIComponent(NEXT)}`;
const SIGN_IN_TO_LINK = `/login?next=${encodeURIComponent(LINK_STEP)}&link=1`;

beforeEach(() => {
  requestMock.mockReset();
  toastMock.success.mockReset();
  toastMock.warning.mockReset();
  resetAuthStoreForTests();
  signedOut();
  resetRuntimeConfig();
  configureRuntime({ apiUrl: "http://api.test" });
});
afterEach(() => vi.useRealTimers());

describe("ContinueView — loading and none", () => {
  it("holds the identity block and three rows while the pending sign-in loads", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải lượt đăng nhập…");
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".min-h-17")).toHaveLength(3);
  });

  it("says the sign-in expired and goes back to the sign-in page with next", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": () => Promise.reject(MISSING()) });
    open();
    expect(await screen.findByRole("heading", { name: "Lượt đăng nhập đã hết hạn" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Về trang đăng nhập" })).toHaveAttribute("href", `/login?next=${encodeURIComponent(NEXT)}`);
    // Opened expired, it is read from the top: nothing took focus.
    expect(screen.getByRole("heading", { name: "Lượt đăng nhập đã hết hạn" })).not.toHaveFocus();
  });

  it("offers to read it again when the server could not be reached", async () => {
    let fail = true;
    route({ "GET /api/v1/auth/sign-in-ticket": () => (fail ? Promise.reject(new TypeError("offline")) : TICKET) });
    open();
    expect(await screen.findByRole("heading", { name: "Chưa tải được lượt đăng nhập" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Không kết nối được. Kiểm tra mạng rồi thử lại.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("heading", { name: "Tiếp tục với Google" })).toBeInTheDocument();
  });
});

describe("ContinueView — unmatched", () => {
  it("shows who the provider says this is and the three choices", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET });
    open();
    expect(await screen.findByRole("heading", { name: "Tiếp tục với Google" })).toBeInTheDocument();
    const identity = screen.getByRole("group", { name: "Tài khoản Google" });
    expect(identity).toHaveTextContent("An Nguyễn");
    expect(identity).toHaveTextContent("an@gmail.com");
    const list = screen.getByRole("list", { name: "Chọn cách tiếp tục" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    const existing = within(list).getByRole("link", { name: /Tôi đã có tài khoản UniWork/ });
    expect(existing).toHaveAttribute("href", SIGN_IN_TO_LINK);
    expect(existing).toHaveTextContent("Đăng nhập một lần để liên kết Google. Lần sau chỉ cần Google.");
    expect(within(list).getByRole("button", { name: /Tạo tài khoản mới/ })).toHaveTextContent("Dùng an@gmail.com để đăng nhập UniWork.");
    // The terms sit under the choice that creates an account.
    expect(screen.getByRole("link", { name: "Điều khoản sử dụng" })).toBeInTheDocument();
    expect(screen.queryByText(/Tổ chức mời bạn qua email công việc/)).toBeNull();
  });

  it("names Apple's hidden email instead of spelling it out, and points work invitations to the right choice", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": RELAY });
    open();
    const identity = await screen.findByRole("group", { name: "Tài khoản Apple" });
    expect(identity).toHaveTextContent("Email ẩn của Apple");
    expect(identity).not.toHaveTextContent("privaterelay");
    expect(screen.getByRole("button", { name: /Tạo tài khoản mới/ })).toHaveTextContent("Dùng email ẩn của Apple để đăng nhập UniWork.");
    expect(screen.getByText('Tổ chức mời bạn qua email công việc? Chọn "Tôi được mời bằng email khác".')).toBeInTheDocument();
  });

  it("creates the account in one press when the provider gave a name, holding every other way while it runs", async () => {
    let finish: (v: unknown) => void = () => {};
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/create": () => new Promise((r) => (finish = r)),
    });
    const { onDone } = open();
    fireEvent.click(await screen.findByRole("button", { name: /Tạo tài khoản mới/ }));
    const create = screen.getByRole("button", { name: /Tạo tài khoản mới/ });
    await waitFor(() => expect(create).toHaveAttribute("aria-busy", "true"));
    // The row says what it is doing, and a polite status says it to a screen reader.
    expect(create).toHaveTextContent("Đang tạo tài khoản…");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Đang tạo tài khoản…")).toBe(true);
    expect(screen.getByRole("link", { name: /Tôi đã có tài khoản/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /Tôi được mời/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Hủy" })).toHaveAttribute("aria-disabled", "true");
    expect(calls("POST /api/v1/auth/sign-in-ticket/create")[0]![1]).toMatchObject({ body: {} });
    await act(async () => finish(SESSION));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" })));
    // The ticket is spent: the screen waits calmly instead of saying it expired.
    expect(screen.getByRole("heading", { name: "Đang đăng nhập…" })).toBeInTheDocument();
  });

  it("asks for a display name first when the provider shared none", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": { ...TICKET, name: "" },
      "POST /api/v1/auth/sign-in-ticket/create": SESSION,
    });
    const { onDone } = open();
    fireEvent.click(await screen.findByRole("button", { name: /Tạo tài khoản mới/ }));
    const field = await screen.findByLabelText("Tên hiển thị");
    expect(field).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
    expect(screen.getByText("Nhập tên hiển thị.")).toBeInTheDocument();
    expect(calls("POST /api/v1/auth/sign-in-ticket/create")).toHaveLength(0);
    fireEvent.change(field, { target: { value: "x".repeat(101) } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
    expect(screen.getByText("Tên hiển thị tối đa 100 ký tự.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "  An   Nguyễn " } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls("POST /api/v1/auth/sign-in-ticket/create")[0]![1]).toMatchObject({ body: { display_name: "An Nguyễn" } });
  });

  it("becomes the existing-account screen when the address took an account meanwhile", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/create": () => Promise.reject(new ApiError("taken", "sign_in_account_conflict", 409)),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Tạo tài khoản mới/ }));
    // One way on, said once: no create row left to meet the same answer,
    // and no second button with the same words.
    const heading = await screen.findByRole("heading", { level: 1, name: "Email này đã có tài khoản UniWork" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getAllByRole("link", { name: "Đăng nhập để liên kết" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Đăng nhập để liên kết" })).toHaveAttribute("href", SIGN_IN_TO_LINK);
    expect(screen.queryByRole("button", { name: /Tạo tài khoản mới/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Tôi đã có tài khoản UniWork/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("counts a 429 down live and lets the person try again when it is over", async () => {
    // Only the clock and the countdown's interval are faked: the requests and
    // the query library keep their real timers, and the countdown starts on a
    // frozen clock, so every tick lands on a whole second.
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/create": () =>
        Promise.reject(Object.assign(new ApiError("slow down", "rate_limited", 429), { retryAfterSeconds: 3 })),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Tạo tài khoản mới/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bạn đã thử nhiều lần liền. Thử lại sau 3 giây.");
    expect(screen.getByRole("button", { name: /Tạo tài khoản mới/ })).toHaveAttribute("aria-disabled", "true");
    // Let the countdown's effects start it before the clock moves.
    await act(async () => {});
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(alert.querySelector("span[aria-hidden]")).toHaveTextContent("Thử lại sau 2 giây.");
    // Said once to a screen reader: the live sentence keeps the wait it started with.
    expect(alert.querySelector(".sr-only")).toHaveTextContent("Thử lại sau 3 giây.");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // The query library tells its observers on the next tick.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: /Tạo tài khoản mới/ })).not.toHaveAttribute("aria-disabled");
  });

  it("offers a retry after a dropped connection", async () => {
    let fail = true;
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/create": () => (fail ? Promise.reject(new TypeError("offline")) : SESSION),
    });
    const { onDone } = open();
    fireEvent.click(await screen.findByRole("button", { name: /Tạo tài khoản mới/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không kết nối được. Kiểm tra mạng rồi thử lại.");
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("says which provider's sign-in expired when it goes away under a command", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/create": () => Promise.reject(MISSING()),
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Tạo tài khoản mới/ }));
    expect(await screen.findByText("Lượt đăng nhập bằng Google đã hết hạn.")).toBeInTheDocument();
    // It replaced the screen under the person's hands: its heading is heard.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Lượt đăng nhập đã hết hạn" })).toHaveFocus());
    // Google starts again from here, next kept; the sign-in page is the other way.
    expect(screen.getByRole("link", { name: "Tiếp tục với Google" }).getAttribute("href")).toContain(
      `/api/v1/auth/google/start?next=${encodeURIComponent(NEXT)}`,
    );
    expect(screen.getByRole("link", { name: "Về trang đăng nhập" })).toHaveAttribute("href", `/login?next=${encodeURIComponent(NEXT)}`);
  });

  it("drops the pending sign-in on Hủy and goes back to sign in, next kept", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "DELETE /api/v1/auth/sign-in-ticket": undefined });
    const { nav } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(NEXT)}`));
    expect(calls("DELETE /api/v1/auth/sign-in-ticket")).toHaveLength(1);
  });
});

describe("ContinueView — invited with another email", () => {
  const openClaim = async () => {
    const out = open();
    fireEvent.click(await screen.findByRole("button", { name: /Tôi được mời bằng email khác/ }));
    return out;
  };

  it("checks the address here, mails a code, and signs in with it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/claim-email": { status: "sent" },
      "POST /api/v1/auth/sign-in-ticket/claim-email/verify": SESSION,
    });
    const { onDone } = await openClaim();
    const email = screen.getByLabelText("Email công việc");
    expect(email).toHaveFocus();
    fireEvent.change(email, { target: { value: "an@acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã" }));
    expect(screen.getByText("Email chưa đúng, ví dụ ten@congty.vn")).toBeInTheDocument();
    expect(calls("POST /api/v1/auth/sign-in-ticket/claim-email")).toHaveLength(0);
    fireEvent.change(email, { target: { value: "an@acme.vn" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã" }));
    expect(await screen.findByText("Nhập mã 6 số vừa gửi tới an@acme.vn. Mã có hiệu lực 15 phút.")).toBeInTheDocument();
    const resend = screen.getByRole("button", { name: "Gửi lại sau 60 giây" });
    expect(resend).toHaveAttribute("aria-disabled", "true");
    await act(async () => {});
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("button", { name: "Gửi lại sau 59 giây" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mã xác nhận"), { target: { value: "123456" } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" })));
    expect(calls("POST /api/v1/auth/sign-in-ticket/claim-email/verify")[0]![1]).toMatchObject({
      body: { email: "an@acme.vn", code: "123456" },
    });
  });

  it("clears a wrong code and says so under the boxes", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/claim-email": { status: "sent" },
      "POST /api/v1/auth/sign-in-ticket/claim-email/verify": () => Promise.reject(new ApiError("no", "invalid_code", 400)),
    });
    await openClaim();
    fireEvent.change(screen.getByLabelText("Email công việc"), { target: { value: "an@acme.vn" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã" }));
    const code = await screen.findByLabelText("Mã xác nhận");
    fireEvent.change(code, { target: { value: "000000" } });
    expect(await screen.findByText("Mã chưa đúng hoặc đã hết hạn. Nhập lại, hoặc gửi mã mới.")).toBeInTheDocument();
    expect(code).toHaveValue("");
    expect(code).toHaveAttribute("aria-invalid", "true");
  });

  it("names the address's paused codes with the wait the server gave", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/claim-email": () =>
        Promise.reject(new ApiError("paused", "rate_limited", 429, undefined, { retry_after: 7200 })),
    });
    await openClaim();
    fireEvent.change(screen.getByLabelText("Email công việc"), { target: { value: "an@acme.vn" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Đã tạm dừng mã xác nhận cho địa chỉ này. Thử lại sau 2 giờ.");
    expect(screen.getByRole("button", { name: "Gửi mã" })).toHaveAttribute("aria-disabled", "true");
  });

  it("asks for the second factor of the invited account, naming it", async () => {
    route({
      "GET /api/v1/auth/sign-in-ticket": TICKET,
      "POST /api/v1/auth/sign-in-ticket/claim-email": { status: "sent" },
      "POST /api/v1/auth/sign-in-ticket/claim-email/verify": { mfa_required: true, mfa_token: "mfa-1" },
      "POST /api/v1/auth/mfa/verify": { ...SESSION, link_skipped: "sign_in_method_taken" },
    });
    const { onDone } = await openClaim();
    fireEvent.change(screen.getByLabelText("Email công việc"), { target: { value: "an@acme.vn" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã" }));
    fireEvent.change(await screen.findByLabelText("Mã xác nhận"), { target: { value: "123456" } });
    expect(await screen.findByRole("heading", { name: "Xác thực hai lớp" })).toBeInTheDocument();
    expect(screen.getByText("Đăng nhập vào an@acme.vn để liên kết Google.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mã xác thực"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // The provider that waited, named in the once-only notice.
    expect(toastMock.warning).toHaveBeenCalledWith(
      "Bạn đã đăng nhập, nhưng chưa liên kết được Google. Thử lại trong Cài đặt › Bảo mật.",
      expect.anything(),
    );
  });
});

describe("ContinueView — the address has an account, or the browser is signed in", () => {
  it("link_required: one way on, the sign-in that links", async () => {
    route({ "GET /api/v1/auth/sign-in-ticket": { ...TICKET, kind: "link_required", email: "an@company.vn" } });
    open();
    expect(await screen.findByRole("heading", { name: "Email này đã có tài khoản UniWork" })).toBeInTheDocument();
    expect(screen.getByText("Đăng nhập vào an@company.vn để liên kết Google.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Đăng nhập để liên kết" })).toHaveAttribute("href", SIGN_IN_TO_LINK);
    expect(screen.queryByRole("list", { name: "Chọn cách tiếp tục" })).toBeNull();
  });

  it("signed in: link to this account, or sign out and ask the provider again", async () => {
    resetAuthStoreForTests();
    setSessionUser(USER);
    route({ "GET /api/v1/auth/sign-in-ticket": TICKET, "POST /api/v1/auth/logout": { status: "ok" } });
    const nav = fakeNav("/auth/continue");
    open({ nav });
    const linkTo = await screen.findByRole("link", { name: /Liên kết Google với an@company.vn/ });
    expect(linkTo).toHaveAttribute("href", LINK_STEP);
    fireEvent.click(screen.getByRole("button", { name: /Dùng tài khoản khác/ }));
    await waitFor(() =>
      expect(nav.openExternal).toHaveBeenCalledWith(`http://api.test/api/v1/auth/google/start?next=${encodeURIComponent(NEXT)}`),
    );
    expect(calls("POST /api/v1/auth/logout")).toHaveLength(1);
    expect(screen.queryByText("Lượt đăng nhập đã hết hạn")).toBeNull();
  });
});

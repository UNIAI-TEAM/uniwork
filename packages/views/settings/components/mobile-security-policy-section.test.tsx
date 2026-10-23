import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock, wrap } from "../../test/api-mock";
import { MobileSecurityPolicySection } from "./mobile-security-policy-section";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

// The host renders Vietnamese (test/api-mock.tsx › localeAdapter).
const LOCK = "Bắt buộc khoá UniChat";
const CAPTURE = "Bắt buộc chặn chụp màn hình";
const PATH = "/api/v1/orgs/acme/mobile-security-policy";

type Init = { method?: string; body?: Record<string, boolean> };

function serve(policy: Record<string, unknown>, put?: (init: Init) => Promise<unknown>) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path === PATH && init?.method === "PUT") return put?.(init) ?? Promise.resolve({ ...policy, ...init.body });
    if (path === PATH) return Promise.resolve(policy);
    return Promise.resolve({});
  });
}

beforeEach(() => {
  requestMock.mockReset();
  toastError.mockReset();
});

// Audit "Security & privacy", privacy-defaults-off: an owner or admin sets the floor under every member's phone.
describe("MobileSecurityPolicySection", () => {
  it("lets an owner or admin require the app lock and screenshot blocking, one at a time", async () => {
    serve({ require_app_lock: false, block_screen_capture: false, can_manage: true });
    render(wrap(<MobileSecurityPolicySection orgSlug="acme" />));
    const lock = await screen.findByRole("switch", { name: LOCK });
    expect(lock).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: CAPTURE })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Máy chưa đặt khoá màn hình/)).toBeInTheDocument();

    fireEvent.click(lock);
    await waitFor(() => expect(screen.getByRole("switch", { name: LOCK })).toHaveAttribute("aria-checked", "true"));
    fireEvent.click(screen.getByRole("switch", { name: CAPTURE }));
    await waitFor(() => expect(screen.getByRole("switch", { name: CAPTURE })).toHaveAttribute("aria-checked", "true"));
    const puts = requestMock.mock.calls.filter(([, init]) => (init as Init | undefined)?.method === "PUT");
    expect(puts).toEqual([
      [PATH, { method: "PUT", body: { require_app_lock: true } }],
      [PATH, { method: "PUT", body: { block_screen_capture: true } }],
    ]);
  });

  it("shows nothing to a member who cannot change it", async () => {
    serve({ require_app_lock: true, block_screen_capture: true, can_manage: false });
    const { container } = render(wrap(<MobileSecurityPolicySection orgSlug="acme" />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(requestMock).toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("says when the server refused, keeps the switch where it was, and ignores a press while one runs", async () => {
    let refuse: (error: Error) => void = () => undefined;
    serve({ require_app_lock: false, block_screen_capture: false, can_manage: true }, () => new Promise((_resolve, reject) => (refuse = reject)));
    render(wrap(<MobileSecurityPolicySection orgSlug="acme" />));
    fireEvent.click(await screen.findByRole("switch", { name: CAPTURE }));
    await waitFor(() => expect(screen.getByRole("switch", { name: LOCK })).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(screen.getByRole("switch", { name: LOCK }));
    await act(async () => refuse(Object.assign(new Error("forbidden"), { status: 403 })));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(requestMock.mock.calls.filter(([, init]) => (init as Init | undefined)?.method === "PUT")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: CAPTURE })).toHaveAttribute("aria-checked", "false");
  });
});

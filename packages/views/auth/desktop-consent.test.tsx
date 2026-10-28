import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { localeAdapter, wrap } from "../test/api-mock";
import { DesktopConsentView, isDesktopCallbackUrl } from "./desktop-consent";

initI18n();

const consent = {
  attempt_id: "attempt_01",
  account_id: "account_01",
  account_name: "Minh Nguyen",
  account_email: "minh@example.com",
  client_id: "uniwork-office",
  deployment_id: "production-eu",
  redirect_uri: "uniwork-office://auth/callback",
  device_label: "Minh's laptop",
  platform: "windows",
  build: "1.2.3",
  csrf_token: "csrf-value",
};
const phone = { ...consent, client_id: "uniwork-chat-mobile", device_label: "Minh's iPhone", platform: "ios" };

describe("DesktopConsentView", () => {
  beforeEach(async () => {
    localeAdapter.persist.mockClear();
    await setLocale("en");
  });

  it("leads with the app, the device and the account, and keeps the server and build behind Details", async () => {
    render(wrap(<DesktopConsentView consent={consent} onDecision={vi.fn(async () => {})} />));

    expect(screen.getByRole("heading", { name: "Allow UniWork Office to sign in?" })).toBeInTheDocument();
    expect(screen.getByText("UniWork Office")).toBeInTheDocument();
    expect(screen.getByText("Minh's laptop")).toBeInTheDocument();
    expect(screen.getByText("Minh Nguyen")).toBeInTheDocument();
    expect(screen.getByText("minh@example.com")).toBeInTheDocument();
    expect(screen.queryByText("production-eu")).toBeNull();
    expect(screen.queryByText("1.2.3")).toBeNull();

    const details = screen.getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("production-eu")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
  });

  it.each([
    ["uniwork-chat-desktop", "UniChat"],
    ["uniwork-office-beta", "UniWork Office"],
    ["some-other-client", "some-other-client"],
  ])("names the client %s as %s in the title, the app cell and the result", (client_id, app) => {
    const { rerender } = render(wrap(<DesktopConsentView consent={{ ...consent, client_id }} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: `Allow ${app} to sign in?` })).toBeInTheDocument();
    expect(screen.getByText(app)).toBeInTheDocument();

    rerender(wrap(<DesktopConsentView consent={{ ...consent, client_id }} state="approved" callbackUrl="uniworkchat://auth/callback?code=c" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("status")).toHaveTextContent(`Allowed ${app} to sign in`);
    expect(screen.getByRole("button", { name: `Open ${app}` })).toBeInTheDocument();
  });

  // Spec §3.5: the phone app's browser sign-in lands on this page too.
  it.each(["ios", "android", "iOS"])("speaks of this phone when the attempt comes from %s", (platform) => {
    render(wrap(<DesktopConsentView consent={{ ...phone, platform }} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "Allow UniChat on this phone to sign in?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow UniChat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allow desktop app" })).toBeNull();
    expect(screen.getByText("Minh's iPhone")).toBeInTheDocument();
  });

  it.each([
    ["approved", "Desktop sign-in result", "Allowed UniWork to sign in"],
    ["cancelled", "Desktop sign-in result", "Desktop sign-in was cancelled."],
    ["error", "Desktop sign-in result", "Couldn't finish the desktop sign-in. Try again."],
    ["expired", "Desktop sign-in result", "This request has expired. Go back to UniWork and try again."],
  ] as const)("renders the %s result state", (state, heading, expectedCopy) => {
    render(wrap(<DesktopConsentView consent={null} state={state} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(expectedCopy);
    expect(screen.queryByRole("button", { name: "Allow desktop app" })).not.toBeInTheDocument();
  });

  it.each([
    ["cancelled", "Phone sign-in was cancelled."],
    ["error", "Couldn't finish signing in on this phone. Try again."],
    ["expired", "This request has expired. Go back to UniChat and try again."],
  ] as const)("says the phone's %s result in the phone's words", (state, expectedCopy) => {
    render(wrap(<DesktopConsentView consent={phone} state={state} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "Phone sign-in result" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(expectedCopy);
  });

  it("offers to try again only where trying here can help", () => {
    const onRetry = vi.fn();
    const { rerender } = render(wrap(<DesktopConsentView consent={null} state="error" onRetry={onRetry} onDecision={vi.fn(async () => {})} />));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // An expired or cancelled attempt is the app's to start again.
    for (const state of ["expired", "cancelled"] as const) {
      rerender(wrap(<DesktopConsentView consent={consent} state={state} onRetry={onRetry} onDecision={vi.fn(async () => {})} />));
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
      expect(screen.getByText("You can close this tab.")).toBeInTheDocument();
    }
  });

  it("holds the consent's shape while the attempt loads", () => {
    const { container } = render(wrap(<DesktopConsentView consent={null} state="pending" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4);
  });

  it("sends approve and cancel decisions", async () => {
    const onDecision = vi.fn(async () => {});
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} />));

    fireEvent.click(screen.getByRole("button", { name: "Allow desktop app" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("cancel"));
  });

  it("keeps both buttons reachable but deaf while one decision is on its way", async () => {
    let finish: () => void = () => {};
    const onDecision = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} />));

    fireEvent.click(screen.getByRole("button", { name: "Allow desktop app" }));
    const approving = await screen.findByRole("button", { name: "Allowing…" });
    expect(approving).toHaveAttribute("aria-busy", "true");
    expect(approving).toHaveAttribute("aria-disabled", "true");
    expect(approving).not.toBeDisabled();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(cancel);
    fireEvent.click(approving);
    expect(onDecision).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Allow desktop app" })).not.toHaveAttribute("aria-disabled"));
  });

  it("signs out for someone who is not this account, and only once", async () => {
    let finish: () => void = () => {};
    const onSwitchAccount = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onDecision = vi.fn(async () => {});
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} onSwitchAccount={onSwitchAccount} />));

    const notYou = screen.getByRole("button", { name: "Not you? Use another account" });
    fireEvent.click(notYou);
    fireEvent.click(notYou);
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
    expect(notYou).toHaveAttribute("aria-busy", "true");
    // Allowing as the account being left is not on offer meanwhile.
    fireEvent.click(screen.getByRole("button", { name: "Allow desktop app" }));
    expect(onDecision).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(notYou).not.toHaveAttribute("aria-busy"));
  });

  it("offers no way to switch accounts when the page gives none", () => {
    render(wrap(<DesktopConsentView consent={consent} onDecision={vi.fn(async () => {})} />));
    expect(screen.queryByRole("button", { name: "Not you? Use another account" })).toBeNull();
  });

  it("speaks Vietnamese by default", async () => {
    await setLocale("vi");
    render(wrap(<DesktopConsentView consent={phone} onDecision={vi.fn(async () => {})} onSwitchAccount={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "Cho phép UniChat trên điện thoại này đăng nhập?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Không phải bạn? Dùng tài khoản khác" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chi tiết" })).toBeInTheDocument();
  });
});

describe("isDesktopCallbackUrl", () => {
  const redirect = "uniworkchat://auth/callback";
  it.each([
    ["uniworkchat://auth/callback?code=c&state=s", redirect, true],
    ["uniwork-office://auth/callback?code=c", "uniwork-office://auth/callback", true],
    ["uniwork-office://auth/callback?code=c", redirect, false],
    ["evil://auth/callback?code=c", redirect, false],
    ["uniworkchat://evil/callback?code=c", redirect, false],
    ["uniworkchat://auth/other?code=c", redirect, false],
    ["https://auth/callback", redirect, false],
    ["not a url", redirect, false],
    ["uniworkchat://auth/callback", "", false],
    ["uniworkchat://auth/callback", undefined, false],
    ["uniworkchat://auth/callback", "::broken", false],
  ])("%s against %s → %s", (value, redirectUri, expected) => {
    expect(isDesktopCallbackUrl(value, redirectUri)).toBe(expected);
  });
});

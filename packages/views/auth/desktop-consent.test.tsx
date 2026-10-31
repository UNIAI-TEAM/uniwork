import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
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
    expect(screen.getByRole("button", { name: `Allow ${app}` })).toBeInTheDocument();

    rerender(wrap(<DesktopConsentView consent={{ ...consent, client_id }} state="approved" callbackUrl="uniworkchat://auth/callback?code=c" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: `You allowed ${app}` })).toBeInTheDocument();
    // The page has already opened the app: the button is the fallback, and the sentence says so.
    expect(screen.getByRole("status")).toHaveTextContent(`If ${app} didn't open, choose "Open ${app}".`);
    expect(screen.getByRole("button", { name: `Open ${app}` })).toBeInTheDocument();
  });

  // Spec §3.5: the phone app's browser sign-in lands on this page too.
  it.each(["ios", "android", "iOS"])("speaks of this phone when the attempt comes from %s", (platform) => {
    render(wrap(<DesktopConsentView consent={{ ...phone, platform }} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "Allow UniChat on this phone to sign in?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow UniChat" })).toBeInTheDocument();
    expect(screen.queryByText(/desktop/i)).toBeNull();
    expect(screen.getByText("Minh's iPhone")).toBeInTheDocument();
  });

  it.each([
    // Read back after a reload that kept no callback: nothing to open from here.
    ["approved", "You allowed UniWork Office", "Go back to UniWork Office to continue."],
    ["cancelled", "Sign-in cancelled", "UniWork Office wasn't signed in."],
    ["error", "Couldn't finish signing in", "Try again. If it still fails, start signing in again from the app."],
    ["expired", "This request has expired", "Go back to UniWork Office and try again."],
  ] as const)("titles the %s result by what happened", (state, heading, expectedCopy) => {
    render(wrap(<DesktopConsentView consent={consent} state={state} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(expectedCopy);
    expect(screen.queryByRole("button", { name: "Allow UniWork Office" })).not.toBeInTheDocument();
  });

  it("guesses no product or platform for an attempt it never read", () => {
    render(wrap(<DesktopConsentView consent={null} state="expired" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "This request has expired" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Go back to the app and try again.");
    expect(screen.queryByText(/UniWork|desktop|tab/i)).toBeNull();
  });

  it("keeps naming the phone's app when the attempt turns out gone after a retry", () => {
    const { rerender } = render(wrap(<DesktopConsentView consent={phone} onDecision={vi.fn(async () => {})} />));
    // The page blanks the attempt while it reads it again, then hears a 410.
    rerender(wrap(<DesktopConsentView consent={null} state="pending" onDecision={vi.fn(async () => {})} />));
    rerender(wrap(<DesktopConsentView consent={null} state="expired" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("status")).toHaveTextContent("Go back to UniChat and try again.");
    // The phone's sign-in sheet has no tab to close.
    expect(screen.queryByText("You can close this tab.")).toBeNull();
  });

  it.each(["cancelled", "expired"] as const)("tells the phone how to get back to the app once %s", (state) => {
    render(wrap(<DesktopConsentView consent={phone} state={state} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByText("Close this page to return to UniChat.")).toBeInTheDocument();
    expect(screen.queryByText("You can close this tab.")).toBeNull();
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

  it("holds the consent's shape while the attempt loads, in the words it will most likely hold", () => {
    resetAuthStoreForTests();
    setSessionUser({
      id: "account_01", email: "minh@example.com", display_name: "Minh Nguyen", onboarded_at: "2026-01-01T00:00:00Z",
      email_verified_at: "2026-01-01T00:00:00Z", onboarding_questionnaire: {}, locale: "en",
    });
    render(wrap(<DesktopConsentView consent={null} state="pending" onDecision={vi.fn(async () => {})} onSwitchAccount={vi.fn(async () => {})} />));
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const bones = [...document.querySelectorAll(".box-decoration-clone")].map((b) => b.textContent);
    // The title and line, every label, this browser's own account, and the two links.
    expect(bones).toEqual(
      expect.arrayContaining([
        "Allow UniChat to sign in?",
        "Check the app and device details before you continue. This approval only applies to this device.",
        "App",
        "Device",
        "Account",
        "Minh Nguyen",
        "minh@",
        "example.com",
        "Details",
        "Not you?",
        "Use another account",
      ]),
    );
    for (const bone of document.querySelectorAll(".box-decoration-clone")) expect(bone.closest('[aria-hidden="true"]')).not.toBeNull();
    // Both links keep the 44px they will have on a touch screen.
    expect(document.querySelectorAll(".pointer-coarse\\:min-h-11")).toHaveLength(2);
    resetAuthStoreForTests();
  });

  it("sends approve and cancel decisions", async () => {
    const onDecision = vi.fn(async () => {});
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} />));

    fireEvent.click(screen.getByRole("button", { name: "Allow UniWork Office" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("cancel"));
  });

  it("keeps both buttons reachable but deaf while one decision is on its way", async () => {
    let finish: () => void = () => {};
    const onDecision = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} />));

    fireEvent.click(screen.getByRole("button", { name: "Allow UniWork Office" }));
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Allow UniWork Office" })).not.toHaveAttribute("aria-disabled"));
  });

  it("signs out for someone who is not this account, and only once", async () => {
    let finish: () => void = () => {};
    const onSwitchAccount = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onDecision = vi.fn(async () => {});
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} onSwitchAccount={onSwitchAccount} />));

    expect(screen.getByText("Not you?")).toBeInTheDocument();
    const notYou = screen.getByRole("button", { name: "Use another account" });
    fireEvent.click(notYou);
    fireEvent.click(notYou);
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
    expect(notYou).toHaveAttribute("aria-busy", "true");
    // Signing out takes a moment: the press is seen.
    expect(notYou).toHaveTextContent("Signing out…");
    // Allowing as the account being left is not on offer meanwhile.
    fireEvent.click(screen.getByRole("button", { name: "Allow UniWork Office" }));
    expect(onDecision).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(notYou).not.toHaveAttribute("aria-busy"));
    expect(notYou).toHaveTextContent("Use another account");
  });

  it("offers no way to switch accounts when the page gives none", () => {
    render(wrap(<DesktopConsentView consent={consent} onDecision={vi.fn(async () => {})} />));
    expect(screen.queryByRole("button", { name: "Use another account" })).toBeNull();
  });

  it("speaks Vietnamese by default", async () => {
    await setLocale("vi");
    render(wrap(<DesktopConsentView consent={phone} onDecision={vi.fn(async () => {})} onSwitchAccount={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "Cho phép UniChat trên điện thoại này đăng nhập?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dùng tài khoản khác" })).toBeInTheDocument();
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

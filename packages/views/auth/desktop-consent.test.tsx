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

describe("DesktopConsentView", () => {
  beforeEach(async () => {
    localeAdapter.persist.mockClear();
    await setLocale("en");
  });

  it("shows app, device, deployment, account and build details", () => {
    render(wrap(<DesktopConsentView consent={consent} onDecision={vi.fn(async () => {})} />));

    expect(screen.getByRole("heading", { name: "Allow UniWork Office to sign in?" })).toBeInTheDocument();
    expect(screen.getByText("UniWork Office")).toBeInTheDocument();
    expect(screen.getByText("Minh's laptop")).toBeInTheDocument();
    expect(screen.getByText("production-eu")).toBeInTheDocument();
    expect(screen.getByText("Minh Nguyen")).toBeInTheDocument();
    expect(screen.getByText("minh@example.com")).toBeInTheDocument();
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

  it.each([
    ["approved", "Allowed UniWork to sign in"],
    ["cancelled", "Desktop sign-in was cancelled."],
    ["error", "The desktop sign-in request could not be completed. Try again."],
    ["expired", "This desktop sign-in request has expired."],
  ] as const)("renders the %s result state", (state, expectedCopy) => {
    render(wrap(<DesktopConsentView consent={null} state={state} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("heading", { name: "Desktop sign-in result" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(expectedCopy);
    expect(screen.queryByRole("button", { name: "Allow desktop app" })).not.toBeInTheDocument();
  });

  it("sends approve and cancel decisions", async () => {
    const onDecision = vi.fn(async () => {});
    render(wrap(<DesktopConsentView consent={consent} onDecision={onDecision} />));

    fireEvent.click(screen.getByRole("button", { name: "Allow desktop app" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve"));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("cancel"));
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

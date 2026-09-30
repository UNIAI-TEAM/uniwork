import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { localeAdapter, wrap } from "../test/api-mock";
import { DesktopConsentView } from "./desktop-consent";

initI18n();

const consent = {
  attempt_id: "attempt_01",
  account_id: "account_01",
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

    expect(screen.getByText("uniwork-office")).toBeInTheDocument();
    expect(screen.getByText("Minh's laptop")).toBeInTheDocument();
    expect(screen.getByText("production-eu")).toBeInTheDocument();
    expect(screen.getByText("account_01")).toBeInTheDocument();
    expect(screen.getByText("1.2.3")).toBeInTheDocument();
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

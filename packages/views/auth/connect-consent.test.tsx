import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { ConnectConsent } from "@uniwork/core/api/endpoints/connect";
import { localeAdapter, wrap } from "../test/api-mock";
import { ConnectConsentView } from "./connect-consent";

initI18n();

const base: ConnectConsent = {
  attempt_id: "a1",
  status: "pending",
  client: { client_id: "c1", name: "Claude", logo_uri: "", verified: true },
  redirect_host: "claude.ai",
  scope: "read",
  organizations: [{ id: "o1", slug: "acme", name: "Acme", enabled: true, reason: "" }],
  csrf_token: "x",
};

describe("ConnectConsentView", () => {
  beforeEach(async () => {
    localeAdapter.persist.mockClear();
    await setLocale("en");
  });

  it("preselects the only enabled organization and approves into it", async () => {
    const onDecision = vi.fn(async () => {});
    render(wrap(<ConnectConsentView consent={base} onDecision={onDecision} />));
    expect(screen.getByRole("heading", { name: "Allow Claude to access UniWork?" })).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve", "o1"));
  });

  it("warns about an unverified client and waits for an enabled organization", async () => {
    const onDecision = vi.fn(async () => {});
    const consent: ConnectConsent = {
      ...base,
      client: { client_id: "c2", name: "Claude", logo_uri: "", verified: false },
      organizations: [
        { id: "o1", slug: "acme", name: "Acme", enabled: false, reason: "connector_disabled" },
        { id: "o2", slug: "beta", name: "Beta", enabled: true, reason: "" },
        { id: "o3", slug: "gamma", name: "Gamma", enabled: true, reason: "" },
      ],
    };
    render(wrap(<ConnectConsentView consent={consent} onDecision={onDecision} />));
    expect(screen.getByText("UniWork has not verified this app. Continue only if you just added it yourself.")).toBeInTheDocument();
    expect(screen.getByText("An admin has not turned on AI connections for this organization")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Gamma/ }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve", "o3"));
  });

  it("explains when no organization allows AI assistants", () => {
    const consent: ConnectConsent = { ...base, organizations: [{ id: "o1", slug: "acme", name: "Acme", enabled: false, reason: "connector_disabled" }] };
    render(wrap(<ConnectConsentView consent={consent} onDecision={vi.fn(async () => {})} />));
    expect(screen.getByText(/None of your organizations allows AI assistants yet/)).toBeInTheDocument();
  });

  it("cancels without an organization", async () => {
    const onDecision = vi.fn(async () => {});
    render(wrap(<ConnectConsentView consent={base} onDecision={onDecision} />));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("cancel", undefined));
  });

  it("shows results and the error code it was sent back with", () => {
    const { rerender } = render(wrap(<ConnectConsentView consent={null} state="expired" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("status")).toHaveTextContent("This connection request has expired.");
    rerender(wrap(<ConnectConsentView consent={null} state="error" errorCode="invalid_client" onDecision={vi.fn(async () => {})} />));
    expect(screen.getByRole("status")).toHaveTextContent("(invalid_client)");
  });

  it("offers Try again for an error but not for an expired request", () => {
    const onRetry = vi.fn();
    const { rerender } = render(wrap(<ConnectConsentView consent={null} state="error" onRetry={onRetry} onDecision={vi.fn(async () => {})} />));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(wrap(<ConnectConsentView consent={null} state="expired" onRetry={onRetry} onDecision={vi.fn(async () => {})} />));
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});

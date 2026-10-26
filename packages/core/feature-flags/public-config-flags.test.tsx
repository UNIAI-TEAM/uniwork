import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { useFlag } from "./context";
import { PublicConfigFlagsProvider } from "./public-config-flags";

const answer = (askUniStream: boolean) =>
  new Response(JSON.stringify({ flags: { ask_uni_stream: askUniStream }, rum_sample_rate: 0, work_management_capabilities: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

/** A promise the test settles by hand, so "in flight" is a state it can hold. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function Badge({ id }: { id: string }) {
  return <span data-testid={id}>{useFlag("ask_uni_stream", false) ? "ON" : "OFF"}</span>;
}

function renderTree(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
  return qc;
}

const forOrg1 = (url: unknown) => String(url).includes("organization_id=org1");

describe("PublicConfigFlagsProvider", () => {
  beforeEach(() => {
    setAccessToken("tok");
    configureRuntime({ apiUrl: "http://api.test" });
    // Globally on, turned off for org1 by an organization override.
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => answer(!forOrg1(url))));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("evaluates flags for the organization inside its scope and org-less outside it", async () => {
    const qc = renderTree(
      <PublicConfigFlagsProvider>
        <Badge id="outside" />
        <PublicConfigFlagsProvider organizationId="org1">
          <Badge id="inside" />
        </PublicConfigFlagsProvider>
      </PublicConfigFlagsProvider>,
    );
    // OFF is also the default, so wait for both answers before reading it.
    await waitFor(() => {
      expect(qc.getQueryData(["public-config", "org1"])).toBeDefined();
      expect(qc.getQueryData(["public-config"])).toBeDefined();
    });
    await waitFor(() => {
      expect(screen.getByTestId("inside").textContent).toBe("OFF");
      expect(screen.getByTestId("outside").textContent).toBe("ON");
    });
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(expect.arrayContaining(["http://api.test/api/v1/config", "http://api.test/api/v1/config?organization_id=org1"]));
  });

  it("keeps the org-less answer while the organization's answer is in flight", async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockImplementation(async (url) => (forOrg1(url) ? pending.promise : answer(true)));
    renderTree(
      <PublicConfigFlagsProvider>
        <PublicConfigFlagsProvider organizationId="org1">
          <Badge id="inside" />
        </PublicConfigFlagsProvider>
      </PublicConfigFlagsProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("inside").textContent).toBe("ON"));
    pending.resolve(answer(false));
    await waitFor(() => expect(screen.getByTestId("inside").textContent).toBe("OFF"));
  });
});

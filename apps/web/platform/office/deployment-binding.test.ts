import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The transport is mocked, not getPublicConfig, so the real config schema stays
// in the loop: a drifted response must degrade there, not in the test double.
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@uniwork/core/api/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@uniwork/core/api/http")>()),
  request: transport.request,
}));

import { useOfficeDeploymentBinding, type OfficeDeploymentBinding } from "./deployment-binding";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seen: Array<OfficeDeploymentBinding | null> = [];
let mounted: { root: Root; container: HTMLElement } | undefined;

function Probe({ organizationId, enabled }: { organizationId: string; enabled?: boolean }): null {
  seen.push(useOfficeDeploymentBinding(organizationId, enabled));
  return null;
}

async function mount(organizationId = "org", enabled?: boolean): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => { root.render(React.createElement(Probe, { organizationId, enabled })); });
  await act(async () => { await Promise.resolve(); });
}

const latest = (): OfficeDeploymentBinding | null | undefined => seen.at(-1);

describe("useOfficeDeploymentBinding", () => {
  beforeEach(() => {
    seen = [];
    transport.request.mockReset();
  });
  afterEach(() => {
    if (mounted) {
      act(() => mounted?.root.unmount());
      mounted.container.remove();
      mounted = undefined;
    }
  });

  it("reads the deployment id and channel the server names, once, for the organization", async () => {
    transport.request.mockResolvedValue({ flags: {}, rum_sample_rate: 0, office_channel: "beta", office_deployment_id: "dep-1" });
    await mount("org 1");
    expect(seen[0]).toBeNull();
    expect(latest()).toEqual({ channel: "beta", deploymentId: "dep-1" });
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(transport.request.mock.calls[0]?.[0]).toBe("/api/v1/config?organization_id=org%201");
  });

  it("names no channel when the server drifts to one it does not know, never a default", async () => {
    for (const drifted of ["nightly", "", 3, null, ["dev"]]) {
      seen = [];
      transport.request.mockResolvedValueOnce({ flags: {}, rum_sample_rate: 0, office_channel: drifted, office_deployment_id: "dep-1" });
      await mount();
      expect(latest()?.channel).toBeUndefined();
      act(() => mounted?.root.unmount());
      mounted?.container.remove();
      mounted = undefined;
    }
  });

  it("names no deployment when the server sends an empty or non-string id", async () => {
    for (const drifted of ["", "   ", 7, null]) {
      seen = [];
      transport.request.mockResolvedValueOnce({ flags: {}, rum_sample_rate: 0, office_channel: "dev", office_deployment_id: drifted });
      await mount();
      expect(latest()?.deploymentId).toBeUndefined();
      act(() => mounted?.root.unmount());
      mounted?.container.remove();
      mounted = undefined;
    }
  });

  it("falls back to an empty binding when the whole response is malformed", async () => {
    for (const malformed of [[1, 2], "nope", null, 42, { flags: "x", rum_sample_rate: 7 }]) {
      seen = [];
      transport.request.mockResolvedValueOnce(malformed);
      await mount();
      expect(latest()).not.toBeNull();
      expect(latest()?.channel).toBeUndefined();
      expect(latest()?.deploymentId).toBeUndefined();
      act(() => mounted?.root.unmount());
      mounted?.container.remove();
      mounted = undefined;
    }
  });

  it("falls back to an empty binding when the request fails", async () => {
    transport.request.mockRejectedValue(new Error("offline"));
    await mount();
    expect(seen[0]).toBeNull();
    expect(latest()).toEqual({});
  });

  it("does not read the config while disabled and stays pending", async () => {
    await mount("org", false);
    expect(transport.request).not.toHaveBeenCalled();
    expect(seen.every((value) => value === null)).toBe(true);
  });

  it("drops an answer that arrives after the host unmounted", async () => {
    let resolve!: (value: unknown) => void;
    transport.request.mockReturnValue(new Promise((r) => { resolve = r; }));
    await mount();
    const rendered = seen.length;
    act(() => mounted?.root.unmount());
    mounted?.container.remove();
    mounted = undefined;
    await act(async () => { resolve({ flags: {}, rum_sample_rate: 0, office_channel: "dev", office_deployment_id: "late" }); await Promise.resolve(); });
    expect(seen).toHaveLength(rendered);
    expect(seen.every((value) => value === null)).toBe(true);
  });
});

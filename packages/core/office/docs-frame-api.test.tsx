import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { docsFrameApiBase, docsFrameSrc, docsFrameTokenRefreshIn, useDocsFrameToken, type DocsFrameApi } from "./docs-frame-api";

afterEach(() => { resetRuntimeConfig(); });

describe("docs frame helpers", () => {
  it("builds the pinned same-origin frame URL", () => {
    expect(docsFrameSrc("1.2.0+abc")).toBe("/office-frame/docs/1.2.0%2Babc/index.html");
  });

  it("reads apiBase from the runtime config", () => {
    configureRuntime({ apiUrl: "https://api.uniwork.test" });
    expect(docsFrameApiBase()).toBe("https://api.uniwork.test/api/v1");
  });

  it("re-mints a minute before expiry, half-life for short tokens, never under 5s", () => {
    expect(docsFrameTokenRefreshIn(10 * 60_000, 0)).toBe(9 * 60_000);
    expect(docsFrameTokenRefreshIn(60_000, 0)).toBe(30_000);
    expect(docsFrameTokenRefreshIn(1_000, 0)).toBe(5_000);
  });
});

describe("useDocsFrameToken", () => {
  it("mints a token scoped to the document and workspace", async () => {
    const mintToken = vi.fn(async () => ({ token: "t1", tokenExpiresAt: Date.now() + 600_000 }));
    const api = { mintToken } as unknown as DocsFrameApi;
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDocsFrameToken(api, "ws-1", "doc-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.token).toBe("t1"));
    expect(mintToken).toHaveBeenCalledWith({ workspaceId: "ws-1", documentId: "doc-1" });
  });
});

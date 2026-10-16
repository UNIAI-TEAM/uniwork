import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import {
  DEFAULT_DOCUMENT_LIMITS,
  formatDocumentSizeMB,
  useDocumentLimits,
  validateDocumentUploadFile,
} from "./limits";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function wrapperWithClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useDocumentLimits and document size formatting", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("returns fallback limits before config loads and when config is malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, documents: { limits: "bad" } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDocumentLimits(), { wrapper: wrapperWithClient(client) });
    expect(result.current).toEqual(DEFAULT_DOCUMENT_LIMITS);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual(DEFAULT_DOCUMENT_LIMITS);
  });

  it("reads documents.limits from GET /api/v1/config when present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        flags: {},
        documents: {
          limits: {
            upload_max_bytes: 104857600,
            save_warn_ratio: 0.85,
            chunked_upload_threshold_bytes: 20971520,
            web_open: {
              docx: { warn_bytes: 31457280 },
              pptx: { warn_bytes: 26214400 },
              pdf: { warn_bytes: 52428800 },
              xlsx: { warn_bytes: 5242880 },
            },
          },
        },
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDocumentLimits(), { wrapper: wrapperWithClient(client) });
    await waitFor(() => expect(result.current.upload_max_bytes).toBe(104857600));
    expect(result.current.save_warn_ratio).toBe(0.85);
    expect(result.current.chunked_upload_threshold_bytes).toBe(20971520);
  });

  it("formats MB deterministically with 0 decimals for whole numbers, <= 1 decimal otherwise, and rounds up when over limit", () => {
    const mib = 1024 * 1024;
    expect(formatDocumentSizeMB(200 * mib, "vi")).toBe("200 MB");
    expect(formatDocumentSizeMB(200 * mib, "en")).toBe("200 MB");
    expect(formatDocumentSizeMB(180 * mib, "vi")).toBe("180 MB");
    expect(formatDocumentSizeMB(Math.round(185.4 * mib), "vi")).toBe("185,4 MB");
    expect(formatDocumentSizeMB(Math.round(185.4 * mib), "en")).toBe("185.4 MB");
    // 1 byte over 200 MiB must round up to 200,1 MB / 200.1 MB, never 200 MB.
    expect(formatDocumentSizeMB(200 * mib + 1, "vi", 200 * mib)).toBe("200,1 MB");
    expect(formatDocumentSizeMB(200 * mib + 1, "en", 200 * mib)).toBe("200.1 MB");
  });

  it("validates file extension and size against upload_max_bytes before upload", () => {
    const maxBytes = 200 * 1024 * 1024;
    expect(validateDocumentUploadFile({ name: "report.pdf", size: maxBytes }, maxBytes)).toEqual({ ok: true });
    expect(validateDocumentUploadFile({ name: "report.pdf", size: maxBytes + 1 }, maxBytes)).toEqual({
      ok: false,
      reason: "too_large",
      maxBytes,
    });
    expect(validateDocumentUploadFile({ name: "installer.exe", size: 1024 }, maxBytes)).toEqual({
      ok: false,
      reason: "unsupported_format",
    });
  });
});

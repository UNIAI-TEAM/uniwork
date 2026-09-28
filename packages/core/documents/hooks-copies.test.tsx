import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { isDocumentNotVerifiable } from "../types/document";
import { useCopyDocument } from "./hooks-copies";
import { documentKeys } from "./keys";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const copied = (over: Record<string, unknown> = {}) => ({
  id: "d2",
  workspace_id: "ws1",
  kind: "file",
  title: "Kế hoạch Q4 (bản sao)",
  revision: "1",
  current_version: 1,
  created_at: "2026-09-28T03:00:00Z",
  updated_at: "2026-09-28T03:00:00Z",
  ...over,
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

async function expectNotVerifiable(run: () => Promise<unknown>): Promise<void> {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(isDocumentNotVerifiable(err)).toBe(true);
}

describe("documents copies hook (G2-07a surface)", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("copies with consent and one key, seeding the new document's detail entry", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: copied() }, 201));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useCopyDocument("ws1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ documentId: "d1", consent: "copy", idempotencyKey: "key-1" });
    });

    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ consent: "copy" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(qc.getQueryData(documentKeys.detail("ws1", "d2"))).toMatchObject({ id: "d2" });
  });

  it("refuses an unverifiable copy answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }, 201));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCopyDocument("ws1"), { wrapper });

    await act(async () => {
      await expectNotVerifiable(() =>
        result.current.mutateAsync({ documentId: "d1", consent: "copy" }),
      );
    });
  });
});

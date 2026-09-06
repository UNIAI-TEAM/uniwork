import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { aiKeys, useAiPanelStore, useAskUni, useDeleteAiConversation } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("ai hooks", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
    useAiPanelStore.setState({ open: false, conversationId: null });
  });

  it("useAskUni waits for the server, then refreshes messages, list, quota and usage", async () => {
    const { qc, wrapper } = setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ conversation_id: "c1", message: { id: "m1", role: "assistant", content: "ok", citations: [] } }),
    );
    const { result } = renderHook(() => useAskUni("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: "?" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(aiKeys.messages("c1")),
        JSON.stringify(aiKeys.conversations("ws1")),
        JSON.stringify(aiKeys.capabilities("ws1")),
        JSON.stringify(aiKeys.usages()),
      ]),
    );
  });

  it("useAskUni surfaces the server's error code instead of rendering an empty turn", async () => {
    const { wrapper } = setup();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "ai_quota_exceeded", message: "hết" } }, 402));
    const { result } = renderHook(() => useAskUni("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ question: "?" }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("useDeleteAiConversation drops the cached messages and refreshes the list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(aiKeys.messages("c1"), []);
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const { result } = renderHook(() => useDeleteAiConversation("ws1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("c1");
    });
    expect(qc.getQueryData(aiKeys.messages("c1"))).toBeUndefined();
  });

  it("the panel store toggles and remembers the selected conversation", () => {
    useAiPanelStore.getState().toggle();
    useAiPanelStore.getState().select("c1");
    expect(useAiPanelStore.getState()).toMatchObject({ open: true, conversationId: "c1" });
    useAiPanelStore.getState().setOpen(false);
    expect(useAiPanelStore.getState().open).toBe(false);
  });
});

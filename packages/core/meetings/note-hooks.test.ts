import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { MeetingNote } from "../types/meeting";
import { meetingKeys, useDeleteNote, useUpdateNote } from "./hooks";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const notes: MeetingNote[] = [{ id: "n1", meeting_id: "m1", author_id: "u1", body: "Gốc" }];

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(meetingKeys.notes("m1"), notes);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

// UNI-2217: an edit or a delete awaits the server, then refetches the notes.
describe("useUpdateNote / useDeleteNote", () => {
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

  // Renders the hook, starts it and checks the cache stays as it was until the server answers.
  async function awaitsThenInvalidates(start: () => { mutate: () => void; isSuccess: () => boolean }, method: string) {
    let answer: (r: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const { qc, wrapper } = client();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(start, { wrapper });
    act(() => result.current.mutate());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(vi.mocked(fetch).mock.calls[0]![1]!.method).toBe(method);
    expect(qc.getQueryData(meetingKeys.notes("m1"))).toBe(notes);
    expect(invalidate).not.toHaveBeenCalled();
    answer(json({ status: "ok" }));
    await waitFor(() => expect(result.current.isSuccess()).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: meetingKeys.notes("m1") });
  }

  it("an edit leaves the cache alone until the server answers, then invalidates the notes", async () => {
    await awaitsThenInvalidates(() => {
      const m = useUpdateNote("m1");
      return { mutate: () => m.mutate({ noteId: "n1", body: "Mới" }), isSuccess: () => m.isSuccess };
    }, "PATCH");
  });

  it("a delete leaves the cache alone until the server answers, then invalidates the notes", async () => {
    await awaitsThenInvalidates(() => {
      const m = useDeleteNote("m1");
      return { mutate: () => m.mutate("n1"), isSuccess: () => m.isSuccess };
    }, "DELETE");
  });
});

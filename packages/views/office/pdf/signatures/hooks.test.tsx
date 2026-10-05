import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { requestMock } from "../../../test/api-mock";
import { savedSignatureKeys, SavedSignatureRequestError, useDeleteSignature, useSavedSignatures, useSaveSignature } from "./hooks";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const row = { id: "s1", label: "Chữ ký", content_type: "image/png", image: "AA==", byte_size: 1, created_at: "2026-10-03T08:00:00Z" };

describe("saved signature hooks", () => {
  beforeEach(() => requestMock.mockReset());

  it("keys the list by organization and reads the route", async () => {
    requestMock.mockResolvedValueOnce({ signatures: [row] });
    const { result } = renderHook(() => useSavedSignatures("o1"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/o1/signatures", expect.objectContaining({ signal: expect.anything() }));
    expect(savedSignatureKeys.list("o1")).toEqual(["saved-signatures", "o1", "list"]);
  });

  it("does not fetch without an organization id", () => {
    const { result } = renderHook(() => useSavedSignatures(""), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("posts the encoded body and resolves the stored row", async () => {
    requestMock.mockResolvedValueOnce({ signature: row });
    const { result } = renderHook(() => useSaveSignature("o1"), { wrapper: wrapper() });
    await expect(result.current.mutateAsync({ label: "Chữ ký", contentType: "image/png", image: "AA==" })).resolves.toMatchObject({ id: "s1" });
    expect(requestMock).toHaveBeenCalledWith("/api/v1/orgs/o1/signatures", expect.objectContaining({ method: "POST", body: { label: "Chữ ký", content_type: "image/png", image: "AA==" } }));
  });

  it("treats an unusable save body as a failure, never success", async () => {
    requestMock.mockResolvedValueOnce({ nope: true });
    const { result } = renderHook(() => useSaveSignature("o1"), { wrapper: wrapper() });
    await expect(result.current.mutateAsync({ label: "x", contentType: "image/png", image: "AA==" })).rejects.toBeInstanceOf(SavedSignatureRequestError);
  });

  it("treats an unproven delete as a failure", async () => {
    requestMock.mockResolvedValueOnce({ status: "nope" });
    const { result } = renderHook(() => useDeleteSignature("o1"), { wrapper: wrapper() });
    await expect(result.current.mutateAsync("s1")).rejects.toMatchObject({ code: "unconfirmed_delete" });
  });

  it("resolves the deleted id when the server confirms", async () => {
    requestMock.mockResolvedValueOnce({ status: "ok" });
    const { result } = renderHook(() => useDeleteSignature("o1"), { wrapper: wrapper() });
    await expect(result.current.mutateAsync("s1")).resolves.toBe("s1");
  });
});

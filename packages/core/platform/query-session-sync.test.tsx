import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { fileKeys } from "../files/keys";
import type { User } from "../types/user";
import { QuerySessionSync } from "./query-session-sync";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

describe("QuerySessionSync", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
  });

  it("invalidates queries when status moves from anon to authed", async () => {
    useAuthStore.setState({ user: null, status: "anon" });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    qc.setQueryData(["chat", "rooms", "ws1"], []);

    render(
      <QueryClientProvider client={qc}>
        <QuerySessionSync queryClient={qc} />
      </QueryClientProvider>,
    );

    useAuthStore.getState().setUser(user);

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());
  });

  it("does not invalidate on the initial loading to authed boot path", async () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <QueryClientProvider client={qc}>
        <QuerySessionSync queryClient={qc} />
      </QueryClientProvider>,
    );

    useAuthStore.getState().setUser(user);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("drops the previous person's resolved files when the account changes", async () => {
    useAuthStore.getState().setUser(user);
    const qc = new QueryClient();
    qc.setQueryData(fileKeys.uploadBatch("u1", "ws1", ["f1"], "inline"), []);
    qc.setQueryData(fileKeys.uploadBatch("u2", "ws1", ["f1"], "inline"), []);
    qc.setQueryData(["chat", "rooms", "ws1"], []);

    render(
      <QueryClientProvider client={qc}>
        <QuerySessionSync queryClient={qc} />
      </QueryClientProvider>,
    );

    useAuthStore.getState().setUser({ ...user, id: "u2" });

    await waitFor(() =>
      expect(qc.getQueryData(fileKeys.uploadBatch("u1", "ws1", ["f1"], "inline"))).toBeUndefined(),
    );
    expect(qc.getQueryData(fileKeys.uploadBatch("u2", "ws1", ["f1"], "inline"))).toEqual([]);
    expect(qc.getQueryData(["chat", "rooms", "ws1"])).toEqual([]);
  });
});

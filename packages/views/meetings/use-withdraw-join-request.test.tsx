import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { requestMock, wrap } from "../test/api-mock";
import { useWithdrawJoinRequestOnLeave } from "./use-withdraw-join-request";

const CANCEL = "/api/v1/meeting-join-requests/jr1/cancel";

function setup(initial: string | undefined) {
  return renderHook(({ id }: { id: string | undefined }) => useWithdrawJoinRequestOnLeave("m1", id), {
    initialProps: { id: initial },
    wrapper: ({ children }: { children: ReactNode }) => wrap(<>{children}</>),
  });
}

describe("useWithdrawJoinRequestOnLeave", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it("takes the knock back when a waiting member leaves", async () => {
    const { unmount } = setup("jr1");
    expect(requestMock).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(CANCEL, expect.objectContaining({ method: "POST" })));
  });

  it("withdraws nothing once the member was admitted", async () => {
    const { rerender, unmount } = setup("jr1");
    rerender({ id: undefined });
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestMock).not.toHaveBeenCalledWith(CANCEL, expect.anything());
  });

  it("does nothing for a person who never knocked", () => {
    const { unmount } = setup(undefined);
    unmount();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

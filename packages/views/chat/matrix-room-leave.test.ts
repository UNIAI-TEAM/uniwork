import { describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import { leaveAndForgetRoom } from "./matrix-room-leave";

function mockClient(membership: string | undefined): MatrixClient {
  return {
    getRoom: vi.fn(() =>
      membership
        ? ({
            getMyMembership: () => membership,
          } as ReturnType<MatrixClient["getRoom"]>)
        : null,
    ),
    leave: vi.fn(async () => ({})),
    forget: vi.fn(async () => ({})),
  } as unknown as MatrixClient;
}

describe("leaveAndForgetRoom", () => {
  it("leaves joined rooms before forgetting", async () => {
    const client = mockClient("join");
    await leaveAndForgetRoom(client, "!room:localhost");
    expect(client.leave).toHaveBeenCalledWith("!room:localhost");
    expect(client.forget).toHaveBeenCalledWith("!room:localhost");
  });

  it("skips leave when already left but still forgets", async () => {
    const client = mockClient("leave");
    await leaveAndForgetRoom(client, "!room:localhost");
    expect(client.leave).not.toHaveBeenCalled();
    expect(client.forget).toHaveBeenCalledWith("!room:localhost");
  });

  it("leaves invite membership before forgetting", async () => {
    const client = mockClient("invite");
    await leaveAndForgetRoom(client, "!room:localhost");
    expect(client.leave).toHaveBeenCalledWith("!room:localhost");
    expect(client.forget).toHaveBeenCalledWith("!room:localhost");
  });
});

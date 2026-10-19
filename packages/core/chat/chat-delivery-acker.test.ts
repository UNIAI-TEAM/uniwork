import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatDeliveryAcker } from "./chat-delivery-acker";

describe("createChatDeliveryAcker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("sends every room of a second in one batch, once per room", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const acker = createChatDeliveryAcker(send);
    acker.ack("r1", Date.now());
    acker.ack("r2", Date.now());
    acker.ack("r1", Date.now());
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith([
      { room_id: "r1", up_to: "2026-10-18T10:00:01.000Z" },
      { room_id: "r2", up_to: "2026-10-18T10:00:01.000Z" },
    ]);
  });

  it("does not ack again what it already acked, and does after a failure", async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const acker = createChatDeliveryAcker(send);
    const last = Date.parse("2026-10-18T09:59:00Z");
    acker.ack("r1", last);
    await vi.advanceTimersByTimeAsync(1_000);
    acker.ack("r1", last); // the failed send left it unacked
    await vi.advanceTimersByTimeAsync(1_000);
    acker.ack("r1", last); // acked at 10:00:02, past the message
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("splits a burst into requests the server takes", async () => {
    const send = vi.fn().mockResolvedValue(true);
    const acker = createChatDeliveryAcker(send);
    for (let i = 0; i < 51; i++) acker.ack(`r${i}`, Date.now());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send.mock.calls.map(([rooms]) => (rooms as unknown[]).length)).toEqual([50, 1]);
  });
});

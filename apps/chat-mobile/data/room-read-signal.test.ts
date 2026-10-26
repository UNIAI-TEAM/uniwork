import { describe, expect, it, vi } from "vitest";
import { onRoomRead, roomWasRead } from "./room-read-signal";

describe("room read signal", () => {
  it("tells the one listener of every read on this phone or another, until it stops listening", () => {
    roomWasRead("r0");
    const heard = vi.fn();
    const stop = onRoomRead(heard);
    roomWasRead("r1");
    expect(heard).toHaveBeenCalledWith("r1");
    const next = vi.fn();
    const stopNext = onRoomRead(next);
    // An older listener's stop does not silence the newer one.
    stop();
    roomWasRead("r2");
    expect(next).toHaveBeenCalledWith("r2");
    expect(heard).toHaveBeenCalledTimes(1);
    stopNext();
    roomWasRead("r3");
    expect(next).toHaveBeenCalledTimes(1);
  });
});

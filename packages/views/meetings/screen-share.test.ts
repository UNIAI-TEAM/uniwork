import { afterEach, describe, expect, it } from "vitest";
import type { Room } from "livekit-client";
import {
  markScreenShareStopByUser,
  screenShareErrorKey,
  screenShareSupported,
  takeScreenShareStopByUser,
} from "./screen-share";

function namedError(name: string, message = ""): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  if (original) Object.defineProperty(navigator, "mediaDevices", original);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("screenShareSupported", () => {
  it("is true only where getDisplayMedia exists", () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getDisplayMedia: () => {} } });
    expect(screenShareSupported()).toBe(true);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {} });
    expect(screenShareSupported()).toBe(false);
  });
});

describe("screenShareErrorKey", () => {
  it("treats a closed picker as no error and an OS block as one", () => {
    expect(screenShareErrorKey(namedError("NotAllowedError", "Permission denied"))).toBeNull();
    expect(screenShareErrorKey(namedError("NotAllowedError", "Permission denied by system"))).toBe(
      "meetings.shareBlockedBySystem",
    );
  });

  it("names an unsupported browser and a capture that would not start", () => {
    expect(screenShareErrorKey(namedError("NotSupportedError"))).toBe("meetings.shareUnsupported");
    expect(screenShareErrorKey(namedError("NotReadableError"))).toBe("meetings.shareFailed");
    expect(screenShareErrorKey(namedError("AbortError"))).toBe("meetings.shareFailed");
  });
});

describe("screen-share stop intent", () => {
  it("is consumed once per room", () => {
    const room = {} as Room;
    expect(takeScreenShareStopByUser(room)).toBe(false);
    markScreenShareStopByUser(room);
    expect(takeScreenShareStopByUser(room)).toBe(true);
    expect(takeScreenShareStopByUser(room)).toBe(false);
  });
});

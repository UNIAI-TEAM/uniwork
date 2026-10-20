import { afterEach, describe, expect, it } from "vitest";
import { useChatDeviceNotificationStore } from "./device-notification-store";

afterEach(() => useChatDeviceNotificationStore.setState({ sound: true, preview: true, badge: true }));

describe("useChatDeviceNotificationStore", () => {
  it("starts with every chat cue on and flips one at a time", () => {
    const store = useChatDeviceNotificationStore;
    expect(store.getState()).toMatchObject({ sound: true, preview: true, badge: true });
    store.getState().setPref("preview", false);
    expect(store.getState()).toMatchObject({ sound: true, preview: false, badge: true });
  });
});

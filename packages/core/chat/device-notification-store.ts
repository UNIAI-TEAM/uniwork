"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * How chat news reaches this device (UniChat › Cài đặt › Thông báo): a sound
 * with the banner, the message text in it, the unread count on the app icon.
 * Kept on the device, never synced: another machine may sit in a meeting room.
 */
export type ChatDeviceNotificationPrefs = { sound: boolean; preview: boolean; badge: boolean };

type ChatDeviceNotificationState = ChatDeviceNotificationPrefs & {
  setPref: (key: keyof ChatDeviceNotificationPrefs, on: boolean) => void;
};

export const useChatDeviceNotificationStore = create<ChatDeviceNotificationState>()(
  persist(
    (set) => ({
      sound: true,
      preview: true,
      badge: true,
      setPref: (key, on) => set({ [key]: on } as Partial<ChatDeviceNotificationPrefs>),
    }),
    {
      name: "uniwork_chat_device_notifications",
      storage: createJSONStorage(() => defaultStorage),
      partialize: ({ sound, preview, badge }) => ({ sound, preview, badge }),
    },
  ),
);

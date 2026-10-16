export { CoreProvider } from "./core-provider";
export type { CoreProviderProps, ClientIdentity } from "./types";
export { defaultStorage, sessionStorageAdapter } from "./storage";
export { registerPushAdapter, getPushAdapter, type PushAdapter, type PushPermission } from "./push-adapter";
export { getDesktopBridge, type DesktopBridge, type SessionProvider } from "./desktop-bridge";
export { useHostFocus } from "./host-focus";
export { createPersistStorage } from "./persist-storage";
export { createWorkspaceAwareStorage, setCurrentWorkspace, getCurrentSlug, getCurrentWsId, subscribeToCurrentSlug, registerForWorkspaceRehydration } from "./workspace-storage";
export { clearWorkspaceStorage } from "./storage-cleanup";
export {
  registerSystemNotificationClickHandler,
  isWebNotificationSupported,
  getWebNotificationPermission,
  requestWebNotificationPermission,
  showWebNotification,
  type SystemNotificationPayload,
  type WebNotificationPermission,
} from "./system-notification";

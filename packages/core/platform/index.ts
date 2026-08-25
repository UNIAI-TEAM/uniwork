// CoreProvider and AuthInitializer are not part of this layer yet: both wire
// the auth and workspace stores, which are domain code and arrive with the
// tier-2 port. What is here is the platform storage contract itself.
export type { CoreProviderProps, ClientIdentity } from "./types";
export { defaultStorage } from "./storage";
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

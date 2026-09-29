/** Identity is copied from the accepted G4-D1 manifest. Keep this module
 * dependency-free so build, navigation policy and tests share one source. */
export const DESKTOP_IDENTITY = Object.freeze({
  appId: "com.uniwork.office",
  executable: "uniwork-office",
  userScheme: "uniwork-office",
  authCallback: "uniwork-office://auth/callback",
  appScheme: "uniwork-office-app",
  previewScheme: "uniwork-office-preview",
  assetScheme: "uniwork-office-asset",
  userDataNamespace: "uniwork-office",
  devNamespace: "uniwork-office-dev",
  origin: "uniwork-office-app://app",
} as const);

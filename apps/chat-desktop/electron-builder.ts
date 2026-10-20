/**
 * electron-builder configuration (D2, UNI-1835), loaded by electron-builder
 * itself (it reads `electron-builder.ts` through jiti). A function of the
 * environment because two things follow the signing certificates the release
 * workflow passes in: the `unsigned` label in the file names, and how the mac
 * app is signed. scripts/package.test.mjs pins both.
 */
import type { Configuration } from "electron-builder";

/**
 * The rolling GitHub release whose `<channel>*.yml` files point at the
 * versioned release (scripts/release.mjs feed). electron-updater's github
 * provider cannot be used: it skips tags that are not plain semver
 * (`chat-desktop-v…`) and reads the repository's latest release, an Office one.
 */
export const UPDATE_FEED_URL = "https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-feed";

// Names follow the download server's contract (scripts/office/installer-urls.mjs
// --prefix unichat): `_<version>_`, then `_unsigned` while that platform has no
// certificate, then os and arch. x64 is spelled out for Windows and Linux, the
// only arch built there: `${arch}` would expand to amd64 (deb) / x86_64 (AppImage).
const label = (certificate: string | undefined): string => (certificate ? "" : "_unsigned");

export function builderConfig(env: Record<string, string | undefined>): Configuration {
  return {
    appId: "com.uniworkos.chat",
    productName: "UniChat",
    directories: {
      buildResources: "build",
      // Not `dist/`: electron-vite writes dist/main and dist/preload there, and a
      // previous package must never be repacked into the next one.
      output: "dist/package",
    },
    files: ["dist/main/**", "dist/preload/**", "resources/**", "package.json"],
    asarUnpack: ["resources/**"],
    protocols: [{ name: "UniChat", schemes: ["uniworkchat"] }],
    // The channel comes from the version's pre-release id (0.1.0-dev.3 → dev.yml
    // and `channel: dev` in app-update.yml; 1.2.0 → latest.yml).
    publish: { provider: "generic", url: UPDATE_FEED_URL },
    npmRebuild: false,
    mac: {
      // Built by `pnpm brand:build` (packages/ui/brand/svg/unichat-icon-desktop.svg).
      icon: "resources/icon.png",
      // The zips are electron-updater's mac payload; people download the dmgs.
      target: [
        { target: "dmg", arch: ["arm64", "x64"] },
        { target: "zip", arch: ["arm64", "x64"] },
      ],
      artifactName: "unichat_${version}" + label(env.CSC_LINK) + "_darwin_${arch}.${ext}",
      ...(env.CSC_LINK
        ? {
            // Developer ID; notarized when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD
            // and APPLE_TEAM_ID are set too.
            hardenedRuntime: true,
            entitlements: "build/entitlements.mac.plist",
            entitlementsInherit: "build/entitlements.mac.plist",
          }
        : {
            // Packaging breaks the signature Electron ships with, and Apple
            // Silicon refuses an unsigned app as damaged: sign ad hoc instead.
            // Hardened runtime's library validation would reject the ad-hoc
            // signed frameworks, and there is nothing to notarize.
            identity: "-",
            hardenedRuntime: false,
            notarize: false,
          }),
      extendInfo: {
        NSMicrophoneUsageDescription: "UniChat dùng micro cho cuộc gọi thoại và video.",
        NSCameraUsageDescription: "UniChat dùng camera cho cuộc gọi video.",
      },
    },
    win: {
      icon: "resources/icon.png",
      target: [{ target: "nsis", arch: ["x64"] }],
      artifactName: "unichat_${version}" + label(env.WIN_CSC_LINK) + "_win32_x64-setup.${ext}",
    },
    linux: {
      icon: "resources/icon.png",
      target: [
        { target: "AppImage", arch: ["x64"] },
        { target: "deb", arch: ["x64"] },
      ],
      executableName: "unichat",
      category: "Network",
      // Linux packages are never signed.
      artifactName: "unichat_${version}_unsigned_linux_x64.${ext}",
    },
  };
}

export default builderConfig(process.env);

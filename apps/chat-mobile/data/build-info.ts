// The running build, read once from the native modules (lib/build-info.ts
// derives it). Nothing here changes while the process lives: a downloaded
// update applies on the next cold start.
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import { buildInfoFrom, type BuildInfo } from "@/lib/build-info";

let cached: BuildInfo | null = null;

export function buildInfo(): BuildInfo {
  cached ??= buildInfoFrom({
    configVersion: Constants.expoConfig?.version,
    nativeVersion: Application.nativeApplicationVersion,
    nativeBuild: Application.nativeBuildVersion,
    appId: Application.applicationId,
    channel: Updates.channel,
    updateId: Updates.updateId,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    runtimeVersion: Updates.runtimeVersion,
    os: Platform.OS,
  });
  return cached;
}

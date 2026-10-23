// Push on or off for this device, from Settings › notifications. See
// command.ts for the layer's rule; registration at launch is app/(app)/_layout.tsx's.
import Constants from "expo-constants";
import { Platform } from "react-native";
import { easProjectId } from "@/lib/runtime-extra";
import { api } from "../api";
import { nativeCalls } from "../calls/native-calls";
import { setPushEnabled } from "../push";
import { useCommand } from "./command";

/**
 * Push on or off for this device (data/push.ts › setPushEnabled), with this
 * build's EAS project and call UI; `ask` is the notification primer. Resolves
 * to the token, or null when nothing can reach this phone.
 */
export const useSetPushEnabled = () =>
  useCommand("account.set_push", (_qc, { enabled, ask }: { enabled: boolean; ask?: () => Promise<boolean> }) =>
    setPushEnabled(enabled, { api, projectId: easProjectId(Constants.expoConfig?.extra), platform: Platform.OS, callUI: nativeCalls.available, ask }),
  );

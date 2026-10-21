// Asking for a permission the way people trust (audit P2): UniChat first says
// what it needs and why (a primer, components/ui/permission-primer.tsx), and
// only on "Continue" lets the system show its one-time prompt; "Not now" keeps
// that prompt for later. Once the system will not ask again (refused for good,
// or turned off in Settings), the primer says so and offers the phone's
// Settings (Linking.openSettings) instead of a button that does nothing. The
// launch-time notifications ask (`once`) is shown a single time per phone: a
// "not now" is remembered and only Settings › Notifications asks again.
// Photos need no primer: the photo picker is the system's own (PHPicker,
// Android's photo picker) and asks UniChat for no permission.
import type { DeviceStore } from "./storage/device-store";

export type PermissionKind = "microphone" | "camera" | "notifications";
/** What the permission is for: the primer's words follow it. */
export type PrimerReason = "voice" | "call" | "video" | "notifications";

export interface PermissionState {
  granted: boolean;
  /** False once the system will not show its prompt again. */
  canAskAgain: boolean;
}

export interface PermissionApi {
  read: (kind: PermissionKind) => Promise<PermissionState>;
  request: (kind: PermissionKind) => Promise<PermissionState>;
}

export type PrimerStep = "granted" | "prime" | "settings";

export interface PrimerRequest {
  kind: PermissionKind;
  reason: PrimerReason;
  step: Exclude<PrimerStep, "granted">;
}

export function primerStep(state: PermissionState): PrimerStep {
  if (state.granted) return "granted";
  return state.canAskAgain ? "prime" : "settings";
}

interface GateDeps {
  api: PermissionApi;
  /** Shows the primer; true when the person chose to go on. */
  present: (request: PrimerRequest) => Promise<boolean>;
  openSettings: () => Promise<void>;
  openStore: () => Promise<DeviceStore>;
}

export interface EnsureOptions {
  /** Ask unprompted (at launch) at most once per phone, and never send the person to Settings unasked. */
  once?: boolean;
}

const dismissedKey = (kind: PermissionKind) => `permission_primer_dismissed:${kind}`;

export function createPermissionGate({ api, present, openSettings, openStore }: GateDeps) {
  return {
    /** Resolves whether the permission is granted once the person has been asked (or chose not to be). */
    async ensure(kind: PermissionKind, reason: PrimerReason, options: EnsureOptions = {}): Promise<boolean> {
      let state: PermissionState;
      try {
        state = await api.read(kind);
      } catch {
        // The status is unreadable: the system's own prompt is still better than none.
        return (await api.request(kind)).granted;
      }
      const step = primerStep(state);
      if (step === "granted") return true;
      if (options.once) {
        const store = await openStore();
        if (step === "settings" || store.getString(dismissedKey(kind))) return false;
        if (!(await present({ kind, reason, step }))) {
          store.set(dismissedKey(kind), "1");
          return false;
        }
        return (await api.request(kind)).granted;
      }
      const go = await present({ kind, reason, step });
      if (step === "settings") {
        if (go) await openSettings();
        return false;
      }
      return go ? (await api.request(kind)).granted : false;
    },
  };
}

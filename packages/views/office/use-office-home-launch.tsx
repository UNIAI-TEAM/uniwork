"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  buildOfficeHomeLink,
  DESKTOP_PLATFORMS,
  type DesktopPlatform,
  type DesktopPlatformGuess,
  type OfficeChannel,
  type OfficeInstallerOption,
  type OfficeLaunchOptions,
  type OfficeLaunchOutcome,
} from "@uniwork/core/office";
import { OfficeInstallPrompt } from "./install-prompt";

/** Marks "no scope" apart from a scope that is undefined. */
const NO_SCOPE = Symbol("no-scope");

/** One press of the button: who it began for, who to tell, and whether the app answered late. */
interface Launch {
  scope: unknown;
  done: (() => void) | undefined;
  lateHandoff: boolean;
}

/** Host wiring of "Open UniWork Office" (no document, no launch ticket). */
export interface OfficeHomeLaunchProps {
  channel: OfficeChannel;
  /** The public deployment profile the link carries; without both, the link has none. */
  deploymentId?: string;
  apiOrigin?: string;
  launch: (url: string, options?: OfficeLaunchOptions) => Promise<OfficeLaunchOutcome>;
  loadInstallers: () => Promise<{ installers: OfficeInstallerOption[]; supportedPlatforms?: readonly DesktopPlatform[] }>;
  loadPlatformHint: () => Promise<DesktopPlatformGuess>;
  downloadInstaller: (platform: DesktopPlatform) => Promise<string>;
  className?: string;
}

export interface OfficeHomeLaunchOptions {
  /** The app took over: launched at once, or after the launcher gave up on it. */
  onLaunched?: () => void;
  /**
   * What the launcher is for (the pick a dialog shows). A launch began for one scope never shows its
   * "launching" state, its installer prompt or its hand-off on another: the next pick starts clean.
   */
  scope?: unknown;
}

export interface OfficeHomeLauncher {
  /** "unknown" until the platform hint answers; "unavailable" without host wiring or on a device no installer exists for. */
  status: "unknown" | "available" | "unavailable";
  launching: boolean;
  run: () => Promise<void>;
  /** The installer dialog; render it wherever the launch button's own dialogs belong. */
  prompt: ReactNode;
}

/**
 * The launch half of "Open UniWork Office": the platform hint, opening the app
 * through its registered scheme, and the installer dialog when the browser saw
 * no hand-off (the app is missing or did not answer). Shared by the header
 * button and the folder-upload warning.
 */
export function useOfficeHomeLaunch(
  props: OfficeHomeLaunchProps | undefined,
  { onLaunched, scope }: OfficeHomeLaunchOptions = {},
): OfficeHomeLauncher {
  const [hint, setHint] = useState<DesktopPlatformGuess | null>(null);
  const [installers, setInstallers] = useState<OfficeInstallerOption[]>([]);
  const [platforms, setPlatforms] = useState<readonly DesktopPlatform[]>(DESKTOP_PLATFORMS);
  // The scope a launch or an installer prompt belongs to; NO_SCOPE when there is none.
  const [launchingFor, setLaunchingFor] = useState<unknown>(NO_SCOPE);
  const [installFor, setInstallFor] = useState<unknown>(NO_SCOPE);
  const [reason, setReason] = useState<"not-installed" | "error">("not-installed");
  const current = useRef<Launch | null>(null);
  const latest = useRef({ onLaunched, scope });
  latest.current = { onLaunched, scope };
  const loadPlatformHint = props?.loadPlatformHint;

  useEffect(() => {
    if (!loadPlatformHint) return;
    let active = true;
    loadPlatformHint().then(
      (value) => {
        if (active) setHint(value);
      },
      () => {
        if (active) setHint({ platform: null, confidence: "unsupported" });
      },
    );
    return () => {
      active = false;
    };
  }, [loadPlatformHint]);

  const status = !props ? "unavailable" : !hint ? "unknown" : hint.confidence === "unsupported" ? "unavailable" : "available";
  const launching = launchingFor === scope;
  const installOpen = installFor === scope;
  const setInstallOpen = (open: boolean) => setInstallFor(open ? scope : NO_SCOPE);

  const run = async () => {
    if (!props || (current.current && current.current.scope === scope)) return;
    // The callback and the scope of the render that pressed the button: a launch that outlives its caller (a dialog dismissed meanwhile) answers to the caller it began with.
    const launch: Launch = { scope, done: latest.current.onLaunched, lateHandoff: false };
    const outlived = () => latest.current.scope !== launch.scope;
    current.current = launch;
    setLaunchingFor(scope);
    try {
      const { channel, deploymentId, apiOrigin, launch: open, loadInstallers } = props;
      const profile = deploymentId && apiOrigin ? { deploymentId, apiOrigin } : undefined;
      const outcome = await open(buildOfficeHomeLink(channel, profile), {
        // The app opened after the launcher gave up: no "did not respond" prompt, now or while the installers load.
        onLateHandoff: () => {
          launch.lateHandoff = true;
          setInstallFor((at: unknown) => (at === launch.scope ? NO_SCOPE : at));
          launch.done?.();
        },
      }).catch((): OfficeLaunchOutcome => "error");
      if (outcome === "launched") {
        launch.done?.();
        return;
      }
      if (outlived()) return;
      setReason(outcome === "not-installed" ? "not-installed" : "error");
      try {
        const loaded = await loadInstallers();
        setInstallers(loaded.installers);
        setPlatforms(loaded.supportedPlatforms ?? DESKTOP_PLATFORMS);
      } catch {
        setInstallers([]);
      }
      if (!launch.lateHandoff && !outlived()) setInstallFor(launch.scope);
    } finally {
      if (current.current === launch) current.current = null;
      setLaunchingFor((at: unknown) => (at === launch.scope ? NO_SCOPE : at));
    }
  };

  const prompt =
    props && hint ? (
      <OfficeInstallPrompt
        open={installOpen}
        channel={props.channel}
        installers={installers}
        supportedPlatforms={platforms}
        platformHint={hint}
        reason={reason}
        onOpenChange={setInstallOpen}
        onOpenAgain={() => {
          setInstallOpen(false);
          void run();
        }}
        onDownload={props.downloadInstaller}
      />
    ) : null;

  return { status, launching, run, prompt };
}

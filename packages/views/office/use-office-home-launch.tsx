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
  /** False keeps the platform hint unloaded (a dialog that is closed). Default true. */
  enabled?: boolean;
  /** The app took over: launched at once, or after the launcher gave up on it. */
  onLaunched?: () => void;
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
  { enabled = true, onLaunched }: OfficeHomeLaunchOptions = {},
): OfficeHomeLauncher {
  const [hint, setHint] = useState<DesktopPlatformGuess | null>(null);
  const [installers, setInstallers] = useState<OfficeInstallerOption[]>([]);
  const [platforms, setPlatforms] = useState<readonly DesktopPlatform[]>(DESKTOP_PLATFORMS);
  const [installOpen, setInstallOpen] = useState(false);
  const [reason, setReason] = useState<"not-installed" | "error">("not-installed");
  const [launching, setLaunching] = useState(false);
  const busy = useRef(false);
  // The app opened after the launcher gave up: no "did not respond" prompt, now or while the installers load.
  const lateHandoff = useRef(false);
  const latest = useRef({ onLaunched });
  latest.current = { onLaunched };
  // The callback of the render that pressed the button: a launch that outlives its caller (a dialog dismissed meanwhile) answers to the caller it began with.
  const launchDone = useRef<(() => void) | undefined>(undefined);
  const loadPlatformHint = props?.loadPlatformHint;

  useEffect(() => {
    if (!enabled || !loadPlatformHint) return;
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
  }, [enabled, loadPlatformHint]);

  const status = !props ? "unavailable" : !hint ? "unknown" : hint.confidence === "unsupported" ? "unavailable" : "available";

  const onLateHandoff = () => {
    lateHandoff.current = true;
    setInstallOpen(false);
    launchDone.current?.();
  };

  const run = async () => {
    if (!props || busy.current) return;
    busy.current = true;
    lateHandoff.current = false;
    launchDone.current = latest.current.onLaunched;
    setLaunching(true);
    try {
      const { channel, deploymentId, apiOrigin, launch, loadInstallers } = props;
      const profile = deploymentId && apiOrigin ? { deploymentId, apiOrigin } : undefined;
      const outcome = await launch(buildOfficeHomeLink(channel, profile), { onLateHandoff }).catch((): OfficeLaunchOutcome => "error");
      if (outcome === "launched") {
        launchDone.current?.();
        return;
      }
      setReason(outcome === "not-installed" ? "not-installed" : "error");
      try {
        const loaded = await loadInstallers();
        setInstallers(loaded.installers);
        setPlatforms(loaded.supportedPlatforms ?? DESKTOP_PLATFORMS);
      } catch {
        setInstallers([]);
      }
      if (!lateHandoff.current) setInstallOpen(true);
    } finally {
      busy.current = false;
      setLaunching(false);
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

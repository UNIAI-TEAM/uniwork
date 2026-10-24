"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

/** How long the folder-upload hand-off waits for the installer list before it shows its toast without the action. */
const INSTALLERS_WAIT_MS = 1_500;

/** The installer list never rejects (a failure reads as "none"); past `ms` the answer is "none" and the load goes on. */
function withinCap(load: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void load.then((found) => {
      clearTimeout(timer);
      resolve(found);
    });
  });
}

/** The way to the installer dialog, handed to the host when the server has an installer for this channel. */
type OpenInstall = () => void;

/** One press of the button: who it began for, who to tell, and whether the app answered late. */
interface Launch {
  scope: unknown;
  done: ((install: OpenInstall | null) => void) | undefined;
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
  /**
   * The folder-upload warning's way of using the launcher. Whatever the outcome of a press (`launched`,
   * `not-installed`, `error`; the browser cannot tell an installed app that kept the page in front from a
   * missing one) the host is told once, with the way to the installer dialog, or null when the server has no
   * installer for this channel. The launcher then opens no installer prompt by itself and keeps no late
   * hand-off watch: the host closes its dialog and decides what to offer. The prompt it renders is standalone,
   * open only through that function, and belongs to no scope.
   */
  onHandoff?: (install: OpenInstall | null) => void;
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
 * button and the folder-upload warning (`onHandoff`).
 */
export function useOfficeHomeLaunch(
  props: OfficeHomeLaunchProps | undefined,
  { onHandoff, scope }: OfficeHomeLaunchOptions = {},
): OfficeHomeLauncher {
  const [hint, setHint] = useState<DesktopPlatformGuess | null>(null);
  const [installers, setInstallers] = useState<OfficeInstallerOption[]>([]);
  const [platforms, setPlatforms] = useState<readonly DesktopPlatform[]>(DESKTOP_PLATFORMS);
  // The scope a launch or an installer prompt belongs to; NO_SCOPE when there is none.
  const [launchingFor, setLaunchingFor] = useState<unknown>(NO_SCOPE);
  const [installFor, setInstallFor] = useState<unknown>(NO_SCOPE);
  const [reason, setReason] = useState<"not-installed" | "error">("not-installed");
  const [standalone, setStandalone] = useState(false);
  const current = useRef<Launch | null>(null);
  // The host's one load of the installers (handoff mode); null until the first press, and again after a failure.
  const installersLoad = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ onHandoff, scope });
  latest.current = { onHandoff, scope };
  const handoff = onHandoff !== undefined;
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
  const installOpen = handoff ? standalone : installFor === scope;
  const setInstallOpen = (open: boolean) => (handoff ? setStandalone(open) : setInstallFor(open ? scope : NO_SCOPE));
  const openInstall = useCallback(() => setStandalone(true), []);

  /** Loads the installers once and says whether this channel has one the prompt could offer (the prompt's own filter). */
  const loadInstallersOnce = (): Promise<boolean> => {
    if (!props) return Promise.resolve(false);
    installersLoad.current ??= props.loadInstallers().then(
      (loaded) => {
        const supported = loaded.supportedPlatforms ?? DESKTOP_PLATFORMS;
        setInstallers(loaded.installers);
        setPlatforms(supported);
        return loaded.installers.some((row) => row.channel === props.channel && supported.includes(row.platform));
      },
      () => {
        installersLoad.current = null;
        return false;
      },
    );
    return installersLoad.current;
  };

  const run = async () => {
    if (!props || (current.current && current.current.scope === scope)) return;
    // The callback and the scope of the render that pressed the button: a launch that outlives its caller (a dialog dismissed meanwhile) answers to the caller it began with.
    const launch: Launch = { scope, done: latest.current.onHandoff, lateHandoff: false };
    const outlived = () => latest.current.scope !== launch.scope;
    current.current = launch;
    setLaunchingFor(scope);
    try {
      const { channel, deploymentId, apiOrigin, launch: open, loadInstallers } = props;
      const profile = deploymentId && apiOrigin ? { deploymentId, apiOrigin } : undefined;
      // Started beside the launch so the host's answer waits for the app, not for a second request, and never past the cap.
      const installable = launch.done ? withinCap(loadInstallersOnce(), INSTALLERS_WAIT_MS) : null;
      const outcome = await open(
        buildOfficeHomeLink(channel, profile),
        launch.done
          ? {}
          : {
              // The app opened after the launcher gave up: no "did not respond" prompt, now or while the installers load.
              onLateHandoff: () => {
                launch.lateHandoff = true;
                setInstallFor((at: unknown) => (at === launch.scope ? NO_SCOPE : at));
              },
            },
      ).catch((): OfficeLaunchOutcome => "error");
      if (launch.done) {
        // The host decides what the outcome means; it ignores a press whose pick is gone.
        launch.done((await installable) ? openInstall : null);
        return;
      }
      if (outcome === "launched" || outlived()) return;
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

  const relaunch = async () => {
    if (!props) return;
    const profile = props.deploymentId && props.apiOrigin ? { deploymentId: props.deploymentId, apiOrigin: props.apiOrigin } : undefined;
    await props.launch(buildOfficeHomeLink(props.channel, profile)).catch(() => undefined);
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
          // Standalone, the pick that pressed the button is gone: send the link and leave the rest to the app.
          if (handoff) void relaunch();
          else void run();
        }}
        onDownload={props.downloadInstaller}
      />
    ) : null;

  return { status, launching, run, prompt };
}

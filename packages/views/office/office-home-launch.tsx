"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
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

/**
 * Opens the installed UniWork Office on its home screen through the app's
 * registered scheme. When the browser saw no hand-off (the app is missing or
 * did not answer) the same installer dialog as "Open in UniWork Office"
 * opens. Hidden until the platform is known, and for good on a device no
 * installer exists for (phones, tablets).
 */
export function OfficeHomeLaunch({ channel, deploymentId, apiOrigin, launch, loadInstallers, loadPlatformHint, downloadInstaller, className }: OfficeHomeLaunchProps) {
  const { t } = useTranslation();
  const [hint, setHint] = useState<DesktopPlatformGuess | null>(null);
  const [installers, setInstallers] = useState<OfficeInstallerOption[]>([]);
  const [platforms, setPlatforms] = useState<readonly DesktopPlatform[]>(DESKTOP_PLATFORMS);
  const [installOpen, setInstallOpen] = useState(false);
  const [reason, setReason] = useState<"not-installed" | "error">("not-installed");
  const [launching, setLaunching] = useState(false);
  const busy = useRef(false);
  // The app opened after the launcher gave up: no "did not respond" prompt, now or while the installers load.
  const lateHandoff = useRef(false);

  useEffect(() => {
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

  if (!hint || hint.confidence === "unsupported") return null;

  const onLateHandoff = () => {
    lateHandoff.current = true;
    setInstallOpen(false);
  };

  const run = async () => {
    if (busy.current) return;
    busy.current = true;
    lateHandoff.current = false;
    setLaunching(true);
    try {
      const profile = deploymentId && apiOrigin ? { deploymentId, apiOrigin } : undefined;
      const outcome = await launch(buildOfficeHomeLink(channel, profile), { onLateHandoff }).catch((): OfficeLaunchOutcome => "error");
      if (outcome === "launched") return;
      setReason(outcome === "not-installed" ? "not-installed" : "error");
      try {
        const profile = await loadInstallers();
        setInstallers(profile.installers);
        setPlatforms(profile.supportedPlatforms ?? DESKTOP_PLATFORMS);
      } catch {
        setInstallers([]);
      }
      if (!lateHandoff.current) setInstallOpen(true);
    } finally {
      busy.current = false;
      setLaunching(false);
    }
  };

  const label = t("documents.home.open_office");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("max-sm:px-2", className)}
        aria-label={label}
        aria-busy={launching || undefined}
        aria-disabled={launching || undefined}
        onClick={() => void run()}
        data-office-home-launch
      >
        {launching ? <Spinner aria-hidden role="presentation" /> : <MonitorUp aria-hidden />}
        <span className="max-sm:sr-only">{label}</span>
      </Button>
      <OfficeInstallPrompt
        open={installOpen}
        channel={channel}
        installers={installers}
        supportedPlatforms={platforms}
        platformHint={hint}
        reason={reason}
        onOpenChange={setInstallOpen}
        onOpenAgain={() => {
          setInstallOpen(false);
          void run();
        }}
        onDownload={downloadInstaller}
      />
    </>
  );
}

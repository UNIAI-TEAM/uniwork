import { useCallback, useEffect, useRef, useState } from "react";
import { getPublicConfig } from "@uniwork/core/api/endpoints/config";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { listDocumentVersions } from "@uniwork/core/api/endpoints/documents-versions";
import { downloadOfficeDesktopBundle, getOfficeDesktopDownload } from "@uniwork/core/api/endpoints/office-desktop";
import { detectDesktopPlatform, DESKTOP_PLATFORMS, selectOfficeInstallerChannel, type DesktopPlatformHints } from "@uniwork/core/office";
import type { Document } from "@uniwork/core/types/document";
import type { DesktopOpenActionProps, FrameDesktopOpenProps, OfficeChannel, OfficeSaveOutcome } from "@uniwork/views/office";
import { launchOfficeDeepLink } from "./desktop-handoff";

/**
 * "Open in desktop app" on the document page, one rule for every web host:
 * the G3 editor (editor-host.tsx) and the genoffice module frames
 * (platform/office-frame). The action shows only once the editor is open and
 * only for a user who may edit; everything else (installers, platform hint,
 * the uniwork:// launch) is the same wiring.
 */
export function desktopOpenAllowed({ open, readonly }: { open: boolean; readonly: boolean }): boolean {
  return open && !readonly;
}

/**
 * The host wiring of `DesktopOpenAction` for one document. `channelReady()`
 * settles once the published installer channel is known, so installer
 * requests never go out with a guessed channel; it is read when a request
 * is made, not when the wiring is built.
 */
export function desktopOpenWiring(
  document: Pick<Document, "id" | "organization_id">,
  channel: OfficeChannel,
  channelReady: () => Promise<OfficeChannel> = () => Promise.resolve(channel),
): Pick<
  DesktopOpenActionProps,
  "channel" | "versionAfterSave" | "loadInstallers" | "loadPlatformHint" | "downloadInstaller" | "launch"
> {
  return {
    channel,
    versionAfterSave: async (outcome: OfficeSaveOutcome) => {
      const versionId = outcome.receipt?.versionId;
      if (!versionId) return null;
      try {
        const page = await listDocumentVersions(document.id, { limit: 100 });
        const committed = page.versions.find((version) => version.id === versionId);
        return committed?.version ?? null;
      } catch {
        return null;
      }
    },
    loadInstallers: async () => {
      const profile = await getOfficeDesktopDownload(document.organization_id, await channelReady());
      return { installers: profile?.installers ?? [], supportedPlatforms: profile?.supported_platforms ?? DESKTOP_PLATFORMS };
    },
    loadPlatformHint: async () => {
      const data = (navigator as Navigator & { userAgentData?: DesktopPlatformHints["userAgentData"] & { getHighEntropyValues?: (keys: string[]) => Promise<{ architecture?: string; bitness?: string }> } }).userAgentData;
      let entropy: { architecture?: string; bitness?: string } = {};
      try { entropy = await data?.getHighEntropyValues?.(["architecture", "bitness"]) ?? {}; } catch { /* Reduced UA remains a safe uncertain hint. */ }
      return detectDesktopPlatform({ userAgent: navigator.userAgent, userAgentData: data ? { platform: data.platform, mobile: data.mobile, ...entropy } : undefined });
    },
    downloadInstaller: async (platform) => {
      const blob = await downloadOfficeDesktopBundle(document.organization_id, await channelReady(), platform);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url; link.download = "UniWork-Office.zip";
      window.document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    launch: launchOfficeDeepLink,
  };
}

/**
 * The same wiring for a genoffice module frame. A frame save answers no
 * receipt, so the version it committed is read back as the document's
 * current version once the save resolved (null keeps the editor open).
 */
export function frameDesktopOpen(document: Pick<Document, "id" | "organization_id" | "current_version">, deploymentId: string | undefined, channel: OfficeChannel = "stable", channelReady?: () => Promise<OfficeChannel>): FrameDesktopOpenProps {
  return {
    ...desktopOpenWiring(document, channel, channelReady),
    deploymentId,
    savedVersion: document.current_version,
    versionAfterSave: async () => {
      try {
        const current = await getDocument(document.id);
        return current?.current_version ? current.current_version : null;
      } catch {
        return null;
      }
    },
  };
}

interface OfficeConfigBinding {
  /** The channel that publishes installers (stable > beta > dev); a pin wins. */
  channel: OfficeChannel;
  /** Settles once the channel is known; read when a request is made, never at render. */
  channelReady: () => Promise<OfficeChannel>;
  /** Undefined (never guessed) until the config answers, so the action fails closed. */
  deploymentId: string | undefined;
}

/**
 * The one public-config read behind "Open in desktop app" for every web host
 * (the G3 editor and the module/docs frames): which channel publishes
 * installers and which deployment the launch ticket binds to. A pinned channel
 * or deployment id wins and is not read from the config. Requests that name a
 * channel wait on `channelReady`; if the config is unavailable they ask for
 * stable and show the "no installer" state.
 */
export function useOfficeConfigBinding(organizationId: string, pinned: { channel?: OfficeChannel; deploymentId?: string } = {}): OfficeConfigBinding {
  const { channel: pinnedChannel, deploymentId: pinnedDeploymentId } = pinned;
  const [publishedChannel, setPublishedChannel] = useState<OfficeChannel | null>(null);
  const [configDeploymentId, setConfigDeploymentId] = useState<string | undefined>(undefined);
  const ready = useRef<Promise<OfficeChannel>>(Promise.resolve("stable"));
  useEffect(() => {
    if (pinnedChannel) ready.current = Promise.resolve(pinnedChannel);
    if (pinnedChannel && pinnedDeploymentId) return undefined;
    let active = true;
    const config = getPublicConfig(organizationId).catch(() => null);
    if (!pinnedChannel) {
      const settled = config.then((value): OfficeChannel => (value ? selectOfficeInstallerChannel(value.office_installers) : null) ?? "stable");
      ready.current = settled;
      void settled.then((channel) => { if (active) setPublishedChannel(channel); });
    }
    // Config unavailable: the binding stays undefined rather than a guessed id.
    void config.then((value) => { if (active) setConfigDeploymentId(value?.office_deployment_id); });
    return () => { active = false; };
  }, [pinnedChannel, pinnedDeploymentId, organizationId]);
  const channelReady = useCallback(() => ready.current, []);
  return { channel: pinnedChannel ?? publishedChannel ?? "stable", channelReady, deploymentId: pinnedDeploymentId ?? configDeploymentId };
}

/** `frameDesktopOpen` bound to the published installer channel and deployment of the document's organization. */
export function useFrameDesktopOpen(document: Pick<Document, "id" | "organization_id" | "current_version">): FrameDesktopOpenProps {
  const { channel, channelReady, deploymentId } = useOfficeConfigBinding(document.organization_id);
  return frameDesktopOpen(document, deploymentId, channel, channelReady);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicConfig } from "@uniwork/core/api/endpoints/config";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { listDocumentVersions } from "@uniwork/core/api/endpoints/documents-versions";
import { getOfficeDesktopDownload } from "@uniwork/core/api/endpoints/office-desktop";
import { detectDesktopPlatform, DESKTOP_PLATFORMS, selectOfficeInstallerChannel, type DesktopPlatform, type DesktopPlatformHints } from "@uniwork/core/office";
import type { Document } from "@uniwork/core/types/document";
import type { DesktopOpenActionProps, FrameDesktopOpenProps, OfficeChannel, OfficeHomeLaunchProps, OfficeSaveOutcome } from "@uniwork/views/office";
import { launchOfficeDeepLink } from "./desktop-handoff";

/**
 * "Open in desktop app" on the document page, for the genoffice module frames
 * and their too-large / failure surfaces. The action shows only once the editor is open and
 * only for a user who may edit; everything else (installers, platform hint,
 * the uniwork:// launch) is the same wiring.
 */
export function desktopOpenAllowed({ open, readonly }: { open: boolean; readonly: boolean }): boolean {
  return open && !readonly;
}

/**
 * The download click: the server audits it and names the one installer, and
 * the browser then downloads that file straight from the release host with
 * its own download bar. Nothing is proxied or buffered through UniWork.
 * Resolves with the file name the dialog shows.
 */
function installerFileName(url: string): string {
  const raw = new URL(url).pathname.split("/").pop() ?? "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function downloadInstallerInBrowser(organizationId: string, channel: OfficeChannel, platform: DesktopPlatform): Promise<string> {
  const profile = await getOfficeDesktopDownload(organizationId, channel, platform);
  const installer = profile?.installers.find((row) => row.platform === platform);
  if (!installer) throw new Error("installer unavailable");
  const file = installerFileName(installer.url);
  const link = window.document.createElement("a");
  // Same tab, no target: a cross-origin `download` is ignored, so a new tab would flash open on the
  // release host and close once the attachment arrives. An attachment response leaves this page as it
  // is; unsaved frame edits keep their beforeunload guard.
  link.href = installer.url; link.download = file;
  window.document.body.append(link); link.click(); link.remove();
  return file;
}

/**
 * The host wiring of `DesktopOpenAction` for one document. `channelReady()`
 * settles once the published installer channel is known, so installer
 * requests never go out with a guessed channel; it is read when a request
 * is made, not when the wiring is built.
 */
function desktopOpenWiring(
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
    ...installerWiring(document.organization_id, channelReady),
    launch: launchOfficeDeepLink,
  };
}

/** The installer half of the wiring: the organization's published installers,
 * this machine's platform, and the browser download of the plain installer. */
function installerWiring(
  organizationId: string,
  channelReady: () => Promise<OfficeChannel>,
): Pick<OfficeHomeLaunchProps, "loadInstallers" | "loadPlatformHint" | "downloadInstaller"> {
  return {
    loadInstallers: async () => {
      const profile = await getOfficeDesktopDownload(organizationId, await channelReady());
      return { installers: profile?.installers ?? [], supportedPlatforms: profile?.supported_platforms ?? DESKTOP_PLATFORMS };
    },
    loadPlatformHint: async () => {
      const data = (navigator as Navigator & { userAgentData?: DesktopPlatformHints["userAgentData"] & { getHighEntropyValues?: (keys: string[]) => Promise<{ architecture?: string; bitness?: string }> } }).userAgentData;
      let entropy: { architecture?: string; bitness?: string } = {};
      try { entropy = await data?.getHighEntropyValues?.(["architecture", "bitness"]) ?? {}; } catch { /* Reduced UA remains a safe uncertain hint. */ }
      return detectDesktopPlatform({ userAgent: navigator.userAgent, userAgentData: data ? { platform: data.platform, mobile: data.mobile, ...entropy } : undefined });
    },
    downloadInstaller: async (platform) => downloadInstallerInBrowser(organizationId, await channelReady(), platform),
  };
}

/**
 * The same wiring for a genoffice module frame. A frame save answers no
 * receipt, so the version it committed is read back as the document's
 * current version once the save resolved (null keeps the editor open).
 */
export function frameDesktopOpen(document: Pick<Document, "id" | "organization_id" | "current_version">, deploymentId: string | undefined, channel: OfficeChannel = "stable", channelReady?: () => Promise<OfficeChannel>, apiOrigin?: string): FrameDesktopOpenProps {
  return {
    ...desktopOpenWiring(document, channel, channelReady),
    deploymentId,
    apiOrigin,
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
  /** The deployment's public API origin for the open link's profile; undefined until the config answers. */
  apiOrigin: string | undefined;
}

/**
 * The one public-config read behind "Open in desktop app" for every web host
 * (the module frames and their notices): which channel publishes
 * installers and which deployment the launch ticket binds to. A pinned channel
 * or deployment id wins and is not read from the config. Requests that name a
 * channel wait on `channelReady`; if the config is unavailable they ask for
 * stable and show the "no installer" state.
 */
function useOfficeConfigBinding(organizationId: string, pinned: { channel?: OfficeChannel; deploymentId?: string } = {}): OfficeConfigBinding {
  const { channel: pinnedChannel, deploymentId: pinnedDeploymentId } = pinned;
  const [publishedChannel, setPublishedChannel] = useState<OfficeChannel | null>(null);
  const [configDeploymentId, setConfigDeploymentId] = useState<string | undefined>(undefined);
  const [apiOrigin, setApiOrigin] = useState<string | undefined>(undefined);
  const ready = useRef<Promise<OfficeChannel>>(Promise.resolve("stable"));
  useEffect(() => {
    if (pinnedChannel) ready.current = Promise.resolve(pinnedChannel);
    let active = true;
    const config = getPublicConfig(organizationId).catch(() => null);
    void config.then((value) => { if (active) setApiOrigin(value?.office_api_origin); });
    if (pinnedChannel && pinnedDeploymentId) return () => { active = false; };
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
  return { channel: pinnedChannel ?? publishedChannel ?? "stable", channelReady, deploymentId: pinnedDeploymentId ?? configDeploymentId, apiOrigin };
}

/** `frameDesktopOpen` bound to the published installer channel and deployment of the document's organization. */
export function useFrameDesktopOpen(document: Pick<Document, "id" | "organization_id" | "current_version">): FrameDesktopOpenProps {
  const { channel, channelReady, deploymentId, apiOrigin } = useOfficeConfigBinding(document.organization_id);
  return frameDesktopOpen(document, deploymentId, channel, channelReady, apiOrigin);
}

/**
 * The same wiring for the Documents library, where every file row carries its
 * own "Open in UniWork Office": one config read for the organization, then a
 * pure per-row builder (rows are not hooks).
 */
export function useDocumentsDesktopOpen(organizationId: string): (document: Pick<Document, "id" | "organization_id" | "current_version">) => FrameDesktopOpenProps {
  const { channel, channelReady, deploymentId, apiOrigin } = useOfficeConfigBinding(organizationId);
  return useCallback(
    (document: Pick<Document, "id" | "organization_id" | "current_version">) => frameDesktopOpen(document, deploymentId, channel, channelReady, apiOrigin),
    [deploymentId, channel, channelReady, apiOrigin],
  );
}

/**
 * "Open UniWork Office" in the Documents header: the app on its home screen,
 * with no document and no launch ticket, and the same installers when it does
 * not answer. The functions are stable, so the platform probe runs once.
 */
export function useOfficeHomeLaunch(organizationId: string): OfficeHomeLaunchProps {
  const { channel, channelReady, deploymentId, apiOrigin } = useOfficeConfigBinding(organizationId);
  const installers = useMemo(() => installerWiring(organizationId, channelReady), [organizationId, channelReady]);
  return { channel, deploymentId, apiOrigin, launch: launchOfficeDeepLink, ...installers };
}

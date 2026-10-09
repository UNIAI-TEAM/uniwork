import { useEffect, useState } from "react";
import { getPublicConfig } from "@uniwork/core/api/endpoints/config";
import { getDocument } from "@uniwork/core/api/endpoints/documents";
import { listDocumentVersions } from "@uniwork/core/api/endpoints/documents-versions";
import { downloadOfficeDesktopBundle, getOfficeDesktopDownload } from "@uniwork/core/api/endpoints/office-desktop";
import { detectDesktopPlatform, DESKTOP_PLATFORMS, type DesktopPlatformHints } from "@uniwork/core/office";
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

/** The host wiring of `DesktopOpenAction` for one document. */
export function desktopOpenWiring(document: Pick<Document, "id" | "organization_id">, channel: OfficeChannel): Pick<
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
      const profile = await getOfficeDesktopDownload(document.organization_id, channel);
      return { installers: profile?.installers ?? [], supportedPlatforms: profile?.supported_platforms ?? DESKTOP_PLATFORMS };
    },
    loadPlatformHint: async () => {
      const data = (navigator as Navigator & { userAgentData?: DesktopPlatformHints["userAgentData"] & { getHighEntropyValues?: (keys: string[]) => Promise<{ architecture?: string; bitness?: string }> } }).userAgentData;
      let entropy: { architecture?: string; bitness?: string } = {};
      try { entropy = await data?.getHighEntropyValues?.(["architecture", "bitness"]) ?? {}; } catch { /* Reduced UA remains a safe uncertain hint. */ }
      return detectDesktopPlatform({ userAgent: navigator.userAgent, userAgentData: data ? { platform: data.platform, mobile: data.mobile, ...entropy } : undefined });
    },
    downloadInstaller: async (platform) => {
      const blob = await downloadOfficeDesktopBundle(document.organization_id, channel, platform);
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
export function frameDesktopOpen(document: Pick<Document, "id" | "organization_id" | "current_version">, deploymentId: string | undefined, channel: OfficeChannel = "stable"): FrameDesktopOpenProps {
  return {
    ...desktopOpenWiring(document, channel),
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

/**
 * The deployment binding the server config advertises for the organization;
 * undefined (never guessed) until it answers, so the action fails closed.
 */
export function useOfficeDeploymentId(organizationId: string): string | undefined {
  const [deploymentId, setDeploymentId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void getPublicConfig(organizationId).then((config) => {
      if (active) setDeploymentId(config.office_deployment_id);
    }).catch(() => {
      // Config unavailable: stay closed rather than guess a deployment id.
    });
    return () => { active = false; };
  }, [organizationId]);
  return deploymentId;
}

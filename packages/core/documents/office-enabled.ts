import { useFlag } from "../feature-flags";
import { useOrganizationConfig } from "../feature-flags/use-public-config";
import { OFFICE_DOCS_WEB_FLAG, OFFICE_ENGINE_FLAG, officeFlagsAllow, officeFormatFlagKey } from "../office/format-flags";

/**
 * Where the Office editor stands for one document: `loading` until the
 * organization's answer first arrives, `on` / `off` once it has, and `unknown`
 * when it could not be read (failed or drifted). Only `on` mounts the editor;
 * only `off` may be described as "turned off".
 */
export type OfficeEnabledState = "loading" | "on" | "off" | "unknown";

/**
 * Whether the Office editor may open a document of `format` owned by
 * `organizationId` (UNI-941). Organization-scoped overrides only evaluate when
 * `GET /api/v1/config` is asked for that organization, so a document with an
 * organization reads its own answer; until it arrives, and when it fails, the
 * editor stays closed (the file card, never a flash of editor). Once an answer
 * has settled it is kept while a refetch is in flight or fails, so a refresh
 * never closes a live editor; only a new settled answer changes the state
 * (UNI-954 F7). A document with no organization id reads the host's global
 * flags, which have no loading state of their own (their defaults read off).
 */
export function useOfficeEnabled(organizationId: string | undefined, format: string | null): { state: OfficeEnabledState; answeredAt: number; retry: () => void } {
  const engine = useFlag(OFFICE_ENGINE_FLAG, false);
  // The format flag defaults on; a format with no flag reads the engine itself.
  const formatOn = useFlag(officeFormatFlagKey(format) ?? OFFICE_ENGINE_FLAG, true);
  const scoped = useOrganizationConfig(organizationId);
  const retry = () => { void scoped.refetch(); };
  // When the newest settled answer arrived: a repeat of the same answer is still a new decision point.
  const answeredAt = scoped.dataUpdatedAt;
  if (!organizationId) return { state: engine && formatOn ? "on" : "off", answeredAt, retry };
  if (scoped.data) return { state: officeFlagsAllow(scoped.data.flags, format) ? "on" : "off", answeredAt, retry };
  return { state: scoped.isError ? "unknown" : "loading", answeredAt, retry };
}

/**
 * Whether a .docx opens in the genoffice Docs frame instead of the unavailable notice
 * (`office_docs_web`, UNI-1013; default on, an explicit override of false turns it off). Same organization-scoped answer
 * and states as `useOfficeEnabled`: only a settled `on` mounts the frame.
 */
export function useOfficeDocsWebEnabled(organizationId: string | undefined): OfficeEnabledState {
  return useOfficeWebFlagEnabled(OFFICE_DOCS_WEB_FLAG, organizationId);
}

/**
 * The same answer for any genoffice web module's flag (`office_pdf_web`,
 * `office_slides_web`, …; UNI-1014/1015/1016): default on like Docs (CONTRACT C14), an explicit
 * override of false turns it off, an absent key reads on.
 */
export function useOfficeWebFlagEnabled(flag: string, organizationId: string | undefined): OfficeEnabledState {
  const global = useFlag(flag, true);
  const scoped = useOrganizationConfig(organizationId);
  if (!organizationId) return global ? "on" : "off";
  if (scoped.data) return scoped.data.flags[flag] !== false ? "on" : "off";
  return scoped.isError ? "unknown" : "loading";
}

/**
 * Whether a UniNote page owned by `organizationId` may be exported
 * (`page_export`, UNI-2004, default off). The export route checks the flag at
 * the page's organization, whose overrides only evaluate when /config is asked
 * for it; only a settled `true` there offers the export. A page with no
 * organization reads the host's flag.
 */
export function usePageExportEnabled(organizationId: string | undefined): boolean {
  const global = useFlag("page_export", false);
  const scoped = useOrganizationConfig(organizationId);
  return organizationId ? scoped.data?.flags.page_export === true : global;
}

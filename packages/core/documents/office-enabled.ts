import { useQuery } from "@tanstack/react-query";
import { getPublicConfig } from "../api/endpoints/config";
import { useFlag } from "../feature-flags";
import { OFFICE_DOCS_WEB_FLAG, OFFICE_ENGINE_FLAG, officeFlagsAllow, officeFormatFlagKey } from "../office/format-flags";

const officeConfigKeys = {
  all: ["office-public-config"] as const,
  organization: (organizationId: string) => [...officeConfigKeys.all, organizationId] as const,
};

/**
 * Where the Office editor stands for one document: `loading` until the
 * organization's answer first arrives, `on` / `off` once it has, and `unknown`
 * when it could not be read (failed or drifted). Only `on` mounts the editor;
 * only `off` may be described as "turned off".
 */
export type OfficeEnabledState = "loading" | "on" | "off" | "unknown";

/**
 * A 200 whose body drifted degrades to `flags: {}` in `getPublicConfig`. The
 * server publishes `office_engine` (a public key) in every healthy answer, so
 * its absence means the answer is unusable: an error, retried and never cached
 * as a settled "off" for the query's stale time (UNI-954 R4-4).
 */
async function fetchOrganizationConfig(organizationId: string | undefined) {
  const config = await getPublicConfig(organizationId);
  if (typeof config.flags[OFFICE_ENGINE_FLAG] !== "boolean") throw new Error("office_config_unreadable");
  return config;
}

function useOrganizationOfficeConfig(organizationId: string | undefined) {
  return useQuery({
    queryKey: officeConfigKeys.organization(organizationId ?? ""),
    queryFn: () => fetchOrganizationConfig(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

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
  const scoped = useOrganizationOfficeConfig(organizationId);
  const retry = () => { void scoped.refetch(); };
  // When the newest settled answer arrived: a repeat of the same answer is still a new decision point.
  const answeredAt = scoped.dataUpdatedAt;
  if (!organizationId) return { state: engine && formatOn ? "on" : "off", answeredAt, retry };
  if (scoped.data) return { state: officeFlagsAllow(scoped.data.flags, format) ? "on" : "off", answeredAt, retry };
  return { state: scoped.isError ? "unknown" : "loading", answeredAt, retry };
}

/**
 * Whether a .docx opens in the genoffice Docs frame instead of the G3 editor
 * (`office_docs_web`, UNI-1013; default off). Same organization-scoped answer
 * and states as `useOfficeEnabled`: only a settled `on` mounts the frame.
 */
export function useOfficeDocsWebEnabled(organizationId: string | undefined): OfficeEnabledState {
  const global = useFlag(OFFICE_DOCS_WEB_FLAG, false);
  const scoped = useOrganizationOfficeConfig(organizationId);
  if (!organizationId) return global ? "on" : "off";
  if (scoped.data) return scoped.data.flags[OFFICE_DOCS_WEB_FLAG] === true ? "on" : "off";
  return scoped.isError ? "unknown" : "loading";
}

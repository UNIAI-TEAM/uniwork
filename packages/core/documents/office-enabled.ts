import { useQuery } from "@tanstack/react-query";
import { getPublicConfig } from "../api/endpoints/config";
import { useFlag } from "../feature-flags";
import { OFFICE_ENGINE_FLAG, officeFlagsAllow, officeFormatFlagKey } from "../office/format-flags";

export const officeConfigKeys = {
  all: ["office-public-config"] as const,
  organization: (organizationId: string) => [...officeConfigKeys.all, organizationId] as const,
};

/**
 * Whether the Office editor may open a document of `format` owned by
 * `organizationId` (UNI-941). Organization-scoped overrides only evaluate when
 * `GET /api/v1/config` is asked for that organization, so a document with an
 * organization reads its own answer; until it arrives, and when it fails, the
 * editor stays closed (the file card, never a flash of editor). A document
 * with no organization id reads the host's global flags.
 */
export function useOfficeEnabled(organizationId: string | undefined, format: string | null): boolean {
  const engine = useFlag(OFFICE_ENGINE_FLAG, false);
  // The format flag defaults on; a format with no flag reads the engine itself.
  const formatOn = useFlag(officeFormatFlagKey(format) ?? OFFICE_ENGINE_FLAG, true);
  const scoped = useQuery({
    queryKey: officeConfigKeys.organization(organizationId ?? ""),
    queryFn: () => getPublicConfig(organizationId),
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  if (!organizationId) return engine && formatOn;
  return scoped.data ? officeFlagsAllow(scoped.data.flags, format) : false;
}

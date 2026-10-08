import { useEffect, useState } from "react";
import type { OfficeChannel } from "@uniwork/views/office";
import { getPublicConfig } from "@uniwork/core/api/endpoints/config";

/** The desktop channel and deployment id the server names in GET /api/v1/config. */
export interface OfficeDeploymentBinding { channel?: OfficeChannel; deploymentId?: string }

/**
 * Reads the deployment binding once. `null` while the read is pending; `{}`
 * when the config is unavailable, so callers stay closed instead of guessing a
 * channel or deployment. A format host reads it once and hands the answer to
 * `OfficeEditorHost` as `officeBinding`, so opening a format costs one request.
 */
export function useOfficeDeploymentBinding(organizationId: string, enabled = true): OfficeDeploymentBinding | null {
  const [binding, setBinding] = useState<OfficeDeploymentBinding | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getPublicConfig(organizationId)
      .then((config) => { if (active) setBinding({ channel: config.office_channel, deploymentId: config.office_deployment_id }); })
      .catch(() => { if (active) setBinding({}); });
    return () => { active = false; };
  }, [enabled, organizationId]);
  return binding;
}

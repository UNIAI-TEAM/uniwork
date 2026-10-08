import { DeploymentProfileResolutionError, type DeploymentProfile, type DeploymentProfileResolution } from "../../shared/deployment";
import { desktopSessionMetadataSchema, type DesktopIpcRequest } from "../../shared/ipc";
import type { DesktopNoDeploymentProfile, NoDeploymentProfileReason } from "../../shared/ipc-auth";

type ProfileOutcome = { readonly profile: DeploymentProfile } | { readonly reason: NoDeploymentProfileReason };

/** Resolves the deployment profile without letting a bad one abort startup. A
 * packaged app opens without auth and answers the auth channels with a fixed
 * reason word; an unpackaged run keeps today's behaviour and rethrows. */
export function resolveProfileOutcome(resolve: () => DeploymentProfileResolution, options: { packaged: boolean }): ProfileOutcome {
  try {
    const resolved = resolve();
    return "kind" in resolved ? { reason: "missing" } : { profile: resolved };
  } catch (error) {
    if (!options.packaged || !(error instanceof DeploymentProfileResolutionError)) throw error;
    if (error.code === "channel_mismatch") return { reason: "channel_mismatch" };
    return { reason: error.code === "no_deployment_profile" ? "missing" : "invalid" };
  }
}

/** Handlers for a host with no deployment profile. Every auth channel stays
 * registered so the renderer never meets `unknown_channel`; each one answers a
 * typed, credential-free value. There is no login to start, cancel or leave. */
export function createNoProfileAuthIpcHandlers(reason: NoDeploymentProfileReason) {
  const signedOut = () => desktopSessionMetadataSchema.parse({ status: "signed-out" });
  return {
    "desktop:auth-config": (_request: DesktopIpcRequest<"desktop:auth-config">): DesktopNoDeploymentProfile => ({ state: "no_deployment_profile", reason }),
    "desktop:auth-session": (_request: DesktopIpcRequest<"desktop:auth-session">) => signedOut(),
    "desktop:auth-start": (_request: DesktopIpcRequest<"desktop:auth-start">) => ({ status: "no_deployment_profile" as const, reason }),
    "desktop:auth-cancel": (_request: DesktopIpcRequest<"desktop:auth-cancel">) => signedOut(),
    "desktop:auth-logout": (_request: DesktopIpcRequest<"desktop:auth-logout">) => signedOut(),
  };
}

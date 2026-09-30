import { writeFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A typed failure used by both build and package entry points. */
export class DeploymentProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeploymentProfileError";
    this.code = code;
  }
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Resolve the deployment profile exactly once at build time.  A production
 * URL is never inferred when the environment is incomplete, and HTTP is only
 * accepted for a local development endpoint.
 */
export function readDeploymentProfileFromEnv(env = process.env, manifest = undefined, packageVersion = "0.1.0", { required = false } = {}) {
  const channel = env.UNIWORK_OFFICE_CHANNEL?.trim() || "dev";
  if (!/^(stable|beta|dev)$/.test(channel)) throw new DeploymentProfileError("invalid-channel", "UNIWORK_OFFICE_CHANNEL must be dev, beta, or stable");
  const deploymentId = env.UNIWORK_OFFICE_DEPLOYMENT_ID?.trim();
  const apiOrigin = env.UNIWORK_OFFICE_API_ORIGIN?.trim();
  if (!deploymentId && !apiOrigin) {
    // Deployment binding normally arrives at download/install time.  The
    // build-time variables are an explicit fallback for local/dev builds and
    // automated tests; a missing pair therefore remains a valid unresolved
    // profile for beta as well.  Callers that truly require a build profile
    // opt in with `required`.
    if (required) throw new DeploymentProfileError("missing", "UNIWORK_OFFICE_DEPLOYMENT_ID and UNIWORK_OFFICE_API_ORIGIN are required for this build");
    return undefined;
  }
  if (!deploymentId || !apiOrigin) throw new DeploymentProfileError("missing", "UNIWORK_OFFICE_DEPLOYMENT_ID and UNIWORK_OFFICE_API_ORIGIN must be provided together");
  if (!DEPLOYMENT_ID_PATTERN.test(deploymentId)) throw new DeploymentProfileError("invalid-deployment-id", "UNIWORK_OFFICE_DEPLOYMENT_ID is invalid");

  let origin;
  try { origin = new URL(apiOrigin); } catch { throw new DeploymentProfileError("invalid-origin", "UNIWORK_OFFICE_API_ORIGIN must be an absolute URL"); }
  const local = isLoopback(origin.hostname);
  if (origin.protocol !== "https:" && !(channel === "dev" && origin.protocol === "http:" && local)) {
    throw new DeploymentProfileError("invalid-origin", "UNIWORK_OFFICE_API_ORIGIN must use HTTPS (HTTP is allowed only for localhost in dev)");
  }
  if (origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "" && origin.pathname !== "/")) {
    throw new DeploymentProfileError("invalid-origin", "UNIWORK_OFFICE_API_ORIGIN must be an origin without credentials, path, query, or fragment");
  }
  const channelIdentity = manifest?.channelProfiles?.[channel];
  if (!channelIdentity) throw new DeploymentProfileError("invalid-manifest", `identity manifest has no ${channel} channel profile`);
  return Object.freeze({ deploymentId, apiOrigin: origin.origin, clientId: channelIdentity.userScheme, channel });
}

export async function writeDeploymentProfile(file, profile) {
  await writeFile(file, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profile;
}

export function deriveBuildMetadata(env = process.env, manifest, packageVersion = "0.1.0") {
  const channel = env.UNIWORK_OFFICE_CHANNEL?.trim() || "dev";
  if (!/^(stable|beta|dev)$/.test(channel)) throw new DeploymentProfileError("invalid-channel", "UNIWORK_OFFICE_CHANNEL must be dev, beta, or stable");
  const buildNumber = env.UNIWORK_OFFICE_BUILD_NUMBER?.trim() || "0";
  if (!/^\d+$/.test(buildNumber)) throw new DeploymentProfileError("invalid-build-number", "UNIWORK_OFFICE_BUILD_NUMBER must be a non-negative integer");
  if (channel === "stable") throw new DeploymentProfileError("stable-unsigned", "stable packaging is refused while signing is disabled");
  const channelIdentity = manifest?.channelProfiles?.[channel];
  if (!channelIdentity) throw new DeploymentProfileError("invalid-manifest", `identity manifest has no ${channel} channel profile`);
  return Object.freeze({ channel, version: channel === "dev" ? `${packageVersion}-dev.${Number(buildNumber)}` : `${packageVersion}-beta.${Number(buildNumber)}`, buildId: channel === "dev" ? "unsigned-dev" : "unsigned", artifactLabel: "unsigned", identity: channelIdentity });
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const deploymentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "invalid deployment id");
const channelSchema = z.enum(["stable", "beta", "dev"]);

export const deploymentProfileSchema = z.object({
  deploymentId: deploymentIdSchema,
  apiOrigin: z.string().url(),
  clientId: z.string().regex(/^[a-z][a-z0-9-]+$/),
  channel: channelSchema,
}).strict().superRefine((value, context) => {
  const origin = new URL(value.apiOrigin);
  const loopback = origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "[::1]";
  if (origin.protocol !== "https:" && !(value.channel === "dev" && origin.protocol === "http:" && loopback)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["apiOrigin"], message: "origin must use HTTPS (HTTP is allowed only for localhost in dev)" });
  }
  if (origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "" && origin.pathname !== "/")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["apiOrigin"], message: "origin cannot contain credentials, path, query, or fragment" });
  }
  const expectedClientId = value.channel === "dev" ? ["uniwork", "office", value.channel].join("-") : ["uniwork", "office"].join("-");
  if (value.clientId !== expectedClientId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["clientId"], message: "client id does not match build channel" });
});

export type DeploymentProfile = z.infer<typeof deploymentProfileSchema>;

export class DeploymentProfileResolutionError extends Error {
  readonly code: "no_deployment_profile" | "invalid" | "channel_mismatch";
  constructor(code: "no_deployment_profile" | "invalid" | "channel_mismatch", message: string) { super(message); this.name = "DeploymentProfileResolutionError"; this.code = code; }
}

function readProfileFile(file: string): unknown | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { return undefined; }
}

export type DeploymentProfileResolution = DeploymentProfile | { readonly kind: "no_deployment_profile"; readonly message: string };

/** Main's only deployment seam. Download-time signed profile replacement plugs in here. */
export function resolveDeploymentProfile(options: { installedProfilePath?: string; userDataDirectory?: string; env?: NodeJS.ProcessEnv; buildChannel?: DesktopChannel } = {}): DeploymentProfileResolution {
  const buildChannel = options.buildChannel ?? "dev";
  const candidates = [options.installedProfilePath, options.userDataDirectory ? join(options.userDataDirectory, "deployment-profile.json") : undefined, join(dirname(fileURLToPath(import.meta.url)), "../deployment-profile.json")].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const raw = readProfileFile(candidate);
    if (raw === undefined) continue;
    const parsed = deploymentProfileSchema.safeParse(raw);
    if (!parsed.success) throw new DeploymentProfileResolutionError("invalid", "installed deployment profile is invalid");
    if (parsed.data.channel !== buildChannel) throw new DeploymentProfileResolutionError("channel_mismatch", "installed deployment profile channel does not match this build");
    return parsed.data;
  }
  const env = options.env ?? process.env;
  if (buildChannel === "dev" && env.UNIWORK_OFFICE_DEPLOYMENT_ID && env.UNIWORK_OFFICE_API_ORIGIN) {
    const clientId = buildChannel === "dev" ? ["uniwork", "office", buildChannel].join("-") : ["uniwork", "office"].join("-");
    const parsed = deploymentProfileSchema.safeParse({ deploymentId: env.UNIWORK_OFFICE_DEPLOYMENT_ID, apiOrigin: env.UNIWORK_OFFICE_API_ORIGIN, clientId, channel: buildChannel });
    if (!parsed.success) throw new DeploymentProfileResolutionError("invalid", "development deployment environment is invalid");
    return parsed.data;
  }
  return { kind: "no_deployment_profile", message: "No deployment profile is installed; download again from your UniWork site" };
}

type DesktopChannel = "stable" | "beta" | "dev";

export function deploymentOriginHost(profile: DeploymentProfile): string {
  return new URL(profile.apiOrigin).host;
}

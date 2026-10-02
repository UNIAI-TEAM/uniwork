import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import manifest from "../identity.json";
import { deploymentOriginHost, type DeploymentProfile } from "./deployment";

const channelSchema = z.enum(["stable", "beta", "dev"]);
const architectureSchema = z.array(z.enum(["x64", "arm64"])).min(1);
const channelIdentitySchema = z.object({
  product: z.string().min(1),
  appId: z.string().regex(/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/),
  executable: z.string().regex(/^[a-z][a-z0-9-]+$/),
  userScheme: z.string().regex(/^[a-z][a-z0-9-]+$/),
  authCallback: z.string().url(),
  userDataNamespace: z.string().regex(/^[a-z][a-z0-9-]+$/),
  devNamespace: z.string().regex(/^[a-z][a-z0-9-]+$/),
  keyNamespace: z.string().regex(/^[a-z][a-z0-9-]+$/),
  artifactPrefix: z.string().regex(/^[a-z][a-z0-9-]+$/),
}).strict();

export const desktopIdentityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("accepted"),
  decision: z.literal("G4-D1"),
  product: z.string().min(1),
  appId: z.string().regex(/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/),
  executable: z.string().regex(/^[a-z][a-z0-9-]+$/),
  artifactPrefix: z.string().regex(/^[a-z][a-z0-9-]+$/),
  userScheme: z.string().regex(/^[a-z][a-z0-9-]+$/),
  authCallback: z.string().url(),
  internalSchemes: z.object({
    app: z.string().regex(/^[a-z][a-z0-9-]+$/),
    preview: z.string().regex(/^[a-z][a-z0-9-]+$/),
    asset: z.string().regex(/^[a-z][a-z0-9-]+$/),
  }).strict(),
  userDataNamespace: z.string().regex(/^[a-z][a-z0-9-]+$/),
  devNamespace: z.string().regex(/^[a-z][a-z0-9-]+$/),
  keyNamespace: z.string().regex(/^[a-z][a-z0-9-]+$/),
  channelNamespaces: z.object({
    stable: z.string().min(1),
    beta: z.string().min(1),
    dev: z.string().min(1),
  }).strict(),
  channelProfiles: z.object({ stable: channelIdentitySchema, beta: channelIdentitySchema, dev: channelIdentitySchema }).strict(),
  build: z.object({
    channel: channelSchema,
    buildId: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
    appVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-(?:dev|beta)\.\d+)?$/),
    platforms: z.object({
      win32: architectureSchema,
      darwin: architectureSchema,
      linux: architectureSchema,
    }).strict(),
  }).strict(),
  engine: z.object({
    version: z.string().min(1),
    contractVersion: z.string().min(1),
    protocolVersion: z.number().int().positive(),
  }).strict(),
  update: z.object({
    enabled: z.literal(false),
    owner: z.string().min(1),
    publisher: z.null(),
    feed: z.null(),
    channel: channelSchema,
  }).strict(),
}).strict();

export type DesktopIdentityManifest = z.infer<typeof desktopIdentityManifestSchema>;

function packagedIdentityOverrides(): Partial<Pick<DesktopIdentityManifest, "product" | "appId" | "executable" | "artifactPrefix" | "userScheme" | "authCallback" | "userDataNamespace" | "devNamespace" | "keyNamespace">> & { build?: Partial<DesktopIdentityManifest["build"]>; update?: Partial<DesktopIdentityManifest["update"]> } {
  // The build writes this profile beside dist/main/index.mjs. Source tests and
  // non-packaged development keep the accepted manifest's dev projection.
  try {
    const profile = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../build-identity.json"), "utf8"));
    const { product, appId, executable, artifactPrefix, userScheme, authCallback, userDataNamespace, devNamespace, keyNamespace } = profile;
    return { product, appId, executable, artifactPrefix, userScheme, authCallback, userDataNamespace, devNamespace, keyNamespace, build: { channel: profile.channel, appVersion: profile.version, buildId: profile.buildId }, update: { channel: profile.channel } };
  } catch { return {}; }
}

const overrides = packagedIdentityOverrides();
export const DESKTOP_IDENTITY_MANIFEST = Object.freeze(desktopIdentityManifestSchema.parse({
  ...manifest,
  ...overrides,
  build: { ...manifest.build, ...(overrides.build ?? {}) },
  update: { ...manifest.update, ...(overrides.update ?? {}) },
}));

/** Shared identity projection used by main, navigation, deep links and tests. */
export const DESKTOP_IDENTITY = Object.freeze({
  appId: DESKTOP_IDENTITY_MANIFEST.appId,
  executable: DESKTOP_IDENTITY_MANIFEST.executable,
  userScheme: DESKTOP_IDENTITY_MANIFEST.userScheme,
  authCallback: DESKTOP_IDENTITY_MANIFEST.authCallback,
  appScheme: DESKTOP_IDENTITY_MANIFEST.internalSchemes.app,
  previewScheme: DESKTOP_IDENTITY_MANIFEST.internalSchemes.preview,
  assetScheme: DESKTOP_IDENTITY_MANIFEST.internalSchemes.asset,
  userDataNamespace: DESKTOP_IDENTITY_MANIFEST.userDataNamespace,
  devNamespace: DESKTOP_IDENTITY_MANIFEST.devNamespace,
  keyNamespace: DESKTOP_IDENTITY_MANIFEST.keyNamespace,
  origin: `${DESKTOP_IDENTITY_MANIFEST.internalSchemes.app}://app`,
} as const);

export function getChannelIdentity(channel: DesktopIdentityManifest["build"]["channel"]): z.infer<typeof channelIdentitySchema> {
  return DESKTOP_IDENTITY_MANIFEST.channelProfiles[channel];
}

export type DesktopDiagnostics = {
  name: string;
  appId: string;
  appVersion: string;
  engineVersion: string;
  contractVersion: string;
  protocolVersion: number;
  channel: DesktopIdentityManifest["build"]["channel"];
  buildId: string;
  deploymentId?: string;
  originHost?: string;
};

export function getDesktopDiagnostics(profile?: DeploymentProfile): DesktopDiagnostics {
  return {
    name: DESKTOP_IDENTITY_MANIFEST.product,
    appId: DESKTOP_IDENTITY.appId,
    appVersion: DESKTOP_IDENTITY_MANIFEST.build.appVersion,
    engineVersion: DESKTOP_IDENTITY_MANIFEST.engine.version,
    contractVersion: DESKTOP_IDENTITY_MANIFEST.engine.contractVersion,
    protocolVersion: DESKTOP_IDENTITY_MANIFEST.engine.protocolVersion,
    channel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    buildId: DESKTOP_IDENTITY_MANIFEST.build.buildId,
    ...(profile ? { deploymentId: profile.deploymentId, originHost: deploymentOriginHost(profile) } : {}),
  };
}

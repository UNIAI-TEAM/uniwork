import { z } from "zod";
import manifest from "../identity.json";

const channelSchema = z.enum(["stable", "beta", "dev"]);
const architectureSchema = z.array(z.enum(["x64", "arm64"])).min(1);

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
  build: z.object({
    channel: channelSchema,
    buildId: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
    appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    platforms: z.object({
      win32: architectureSchema,
      darwin: architectureSchema,
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
export const DESKTOP_IDENTITY_MANIFEST = Object.freeze(desktopIdentityManifestSchema.parse(manifest));

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

export type DesktopDiagnostics = {
  appId: string;
  appVersion: string;
  engineVersion: string;
  contractVersion: string;
  protocolVersion: number;
  channel: DesktopIdentityManifest["build"]["channel"];
  buildId: string;
};

export function getDesktopDiagnostics(): DesktopDiagnostics {
  return {
    appId: DESKTOP_IDENTITY.appId,
    appVersion: DESKTOP_IDENTITY_MANIFEST.build.appVersion,
    engineVersion: DESKTOP_IDENTITY_MANIFEST.engine.version,
    contractVersion: DESKTOP_IDENTITY_MANIFEST.engine.contractVersion,
    protocolVersion: DESKTOP_IDENTITY_MANIFEST.engine.protocolVersion,
    channel: DESKTOP_IDENTITY_MANIFEST.build.channel,
    buildId: DESKTOP_IDENTITY_MANIFEST.build.buildId,
  };
}

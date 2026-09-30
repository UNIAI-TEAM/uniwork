import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST, desktopIdentityManifestSchema, getDesktopDiagnostics } from "../shared/identity";

describe("accepted desktop identity", () => {
  it("keeps dev and stable namespaces separate", () => {
    expect(desktopIdentityManifestSchema.parse(DESKTOP_IDENTITY_MANIFEST)).toEqual(DESKTOP_IDENTITY_MANIFEST);
    expect(DESKTOP_IDENTITY_MANIFEST.status).toBe("accepted");
    expect(DESKTOP_IDENTITY_MANIFEST.decision).toBe("G4-D1");
    expect(DESKTOP_IDENTITY_MANIFEST.channelNamespaces.dev).not.toBe(DESKTOP_IDENTITY_MANIFEST.channelNamespaces.stable);
    expect(DESKTOP_IDENTITY_MANIFEST.devNamespace).not.toBe(DESKTOP_IDENTITY_MANIFEST.userDataNamespace);
    expect(DESKTOP_IDENTITY.origin).toBe(`${DESKTOP_IDENTITY_MANIFEST.internalSchemes.app}://app`);
  });

  it("uses the same manifest values for host identity and diagnostics", () => {
    const diagnostics = getDesktopDiagnostics();
    expect(diagnostics).toMatchObject({
      appId: DESKTOP_IDENTITY_MANIFEST.appId,
      appVersion: DESKTOP_IDENTITY_MANIFEST.build.appVersion,
      engineVersion: DESKTOP_IDENTITY_MANIFEST.engine.version,
      contractVersion: DESKTOP_IDENTITY_MANIFEST.engine.contractVersion,
      protocolVersion: DESKTOP_IDENTITY_MANIFEST.engine.protocolVersion,
      channel: DESKTOP_IDENTITY_MANIFEST.build.channel,
      buildId: DESKTOP_IDENTITY_MANIFEST.build.buildId,
    });
  });

  it("has no duplicated identity literals in production host modules", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const identityValues = [
      DESKTOP_IDENTITY_MANIFEST.appId,
      DESKTOP_IDENTITY_MANIFEST.executable,
      DESKTOP_IDENTITY_MANIFEST.userScheme,
      DESKTOP_IDENTITY_MANIFEST.authCallback,
      DESKTOP_IDENTITY_MANIFEST.internalSchemes.app,
      DESKTOP_IDENTITY_MANIFEST.internalSchemes.preview,
      DESKTOP_IDENTITY_MANIFEST.internalSchemes.asset,
      DESKTOP_IDENTITY_MANIFEST.userDataNamespace,
      DESKTOP_IDENTITY_MANIFEST.devNamespace,
      DESKTOP_IDENTITY_MANIFEST.keyNamespace,
    ];
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory() && !["dist", "coverage", "node_modules"].includes(entry.name)) visit(file);
        else if (entry.isFile() && /\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.mjs")) files.push(file);
      }
    };
    visit(root);
    const duplicates = files.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return identityValues.filter((value) => source.includes(value)).map((value) => `${file}:${value}`);
    }).filter((entry) => !entry.includes("shared\\identity.ts") && !entry.includes("shared/identity.ts"));
    expect(duplicates).toEqual([]);
  });
});

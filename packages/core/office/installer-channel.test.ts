import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublicConfig } from "../api/endpoints/config";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { selectOfficeInstallerChannel } from "./installer-channel";
import type { OfficeInstallerOption } from "./desktop-platform";

const row = (channel: "dev" | "beta" | "stable"): OfficeInstallerOption => ({ platform: "win32-x64", url: "https://dl.example/UniWork-Office.exe", kind: ".exe", channel });

describe("selectOfficeInstallerChannel", () => {
  it("prefers stable, then beta, then dev", () => {
    expect(selectOfficeInstallerChannel({ dev: [row("dev")], beta: [row("beta")], stable: [row("stable")] })).toBe("stable");
    expect(selectOfficeInstallerChannel({ dev: [row("dev")], beta: [row("beta")], stable: [] })).toBe("beta");
    expect(selectOfficeInstallerChannel({ dev: [row("dev")], beta: [], stable: [] })).toBe("dev");
  });

  it("returns null when no channel has an installer or the catalogue is missing", () => {
    expect(selectOfficeInstallerChannel({ dev: [], beta: [], stable: [] })).toBeNull();
    expect(selectOfficeInstallerChannel(undefined)).toBeNull();
  });

  describe("with a drifted GET /config", () => {
    beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); configureRuntime({ apiUrl: "http://api.test" }); });
    afterEach(() => { vi.unstubAllGlobals(); resetRuntimeConfig(); });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    it("selects none for malformed installer rows", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_installers: { stable: "nope", beta: [{ platform: 1 }], dev: 5 } }));
      expect(selectOfficeInstallerChannel((await getPublicConfig()).office_installers)).toBeNull();
    });

    it("selects dev when only dev is published", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ flags: {}, rum_sample_rate: 0, office_installers: { dev: [{ platform: "win32-x64", kind: ".exe", url: "https://dl.example/UniWork-Office.exe" }], beta: [], stable: [] } }));
      expect(selectOfficeInstallerChannel((await getPublicConfig()).office_installers)).toBe("dev");
    });
  });
});

import { fixtureManifest } from "./fixtures";
import type { ReleasesManifest } from "./manifest";

/**
 * DESIGN-ONLY seam (UNI-2098 Step 1). Step 2 replaces the body with
 * `fetch("/downloads/office/releases.json", { cache: "no-store", signal })`
 * parsed leniently; the callers do not change. Here the answer is a fixture,
 * after a short delay so the loading state is visible.
 */
export async function loadManifest(locale: "vi" | "en", options: { newer?: boolean; empty?: boolean; fail?: boolean } = {}): Promise<ReleasesManifest> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (options.fail) throw new Error("manifest unreachable");
  if (options.empty) return { schema: 1, generated_at: "2026-10-22T03:41:00Z", base_url: "https://uniworkos.com/downloads/office", channels: {} };
  return fixtureManifest(locale, options.newer);
}

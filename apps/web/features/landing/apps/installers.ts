"use client";
import { useEffect, useMemo, useState } from "react";
import {
  DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, selectOfficeInstallerChannel,
  type DesktopOS, type DesktopPlatformGuess, type OfficeInstallerOption,
} from "@uniwork/core/office";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { readBrowserPlatformGuess, UNKNOWN_PLATFORM } from "../office-platform-hint";
import { DESKTOP_ORDER, type InstallerCatalogue, type PhoneOS } from "./catalog";

export interface AppOsGroup { os: DesktopOS; installers: OfficeInstallerOption[] }
export interface AppInstallers {
  status: "loading" | "ready" | "error";
  groups: AppOsGroup[];
  version: string | undefined;
  guess: DesktopPlatformGuess;
  retry: () => void;
  retrying: boolean;
}

/** Installers of one channel grouped by OS; an OS with no published variant is left out. */
function groupInstallers(installers: readonly OfficeInstallerOption[]): AppOsGroup[] {
  return DESKTOP_ORDER.flatMap((os) => {
    const rows = DESKTOP_PLATFORMS.flatMap((platform) => {
      const row = DESKTOP_INSTALLER_KINDS[platform].os === os ? installers.find((item) => item.platform === platform) : undefined;
      return row ? [row] : [];
    });
    return rows.length > 0 ? [{ os, installers: rows }] : [];
  });
}

/**
 * The installers the web already offers: one public config catalogue, on the
 * most stable channel that publishes one. Nothing is hard-coded, and a variant
 * that is not published is simply absent. The catalogue and the visitor's
 * platform are read in the browser only, so the server's HTML and the first
 * client render agree (both show the loading shell).
 */
export function useAppInstallers(catalogue: InstallerCatalogue | null): AppInstallers {
  const query = usePublicConfig();
  const [guess, setGuess] = useState<DesktopPlatformGuess | undefined>();
  useEffect(() => {
    let live = true;
    void readBrowserPlatformGuess().then((value) => { if (live) setGuess(value); }, () => { if (live) setGuess(UNKNOWN_PLATFORM); });
    return () => { live = false; };
  }, []);
  const config = query.data;
  const published = useMemo(() => {
    const channels = catalogue ? config?.[catalogue] : undefined;
    const channel = selectOfficeInstallerChannel(channels);
    const installers = channel ? channels?.[channel] ?? [] : [];
    const versions = installers.flatMap((row) => (row.version ? [row.version] : []));
    return { groups: groupInstallers(installers), version: versions[0] };
  }, [config, catalogue]);
  // A failed refetch keeps the catalogue it already had; only "no answer at all" is an error.
  const status = guess === undefined || (query.isPending && !config) ? "loading" : !config && query.isError ? "error" : "ready";
  return { status, ...published, guess: guess ?? UNKNOWN_PLATFORM, retry: () => { void query.refetch(); }, retrying: query.isFetching };
}

export interface StoreLink { os: PhoneOS; href: string; label: "appStore" | "testflight" | "googlePlay" | "playInternal"; pilot: boolean }

// The public store page wins; the pilot link is offered only while there is none.
const STORE_LINKS = {
  ios: [{ key: "ios", label: "appStore" }, { key: "testflight", label: "testflight" }],
  android: [{ key: "android", label: "googlePlay" }, { key: "play_internal", label: "playInternal" }],
} as const;

/** UniChat's phone builds from the public config; a phone with nothing published is absent. */
export function useStoreLinks(enabled: boolean): Partial<Record<PhoneOS, StoreLink>> {
  const stores = usePublicConfig().data?.unichat_stores;
  return useMemo(() => {
    if (!enabled || !stores) return {};
    const out: Partial<Record<PhoneOS, StoreLink>> = {};
    for (const os of ["ios", "android"] as const) {
      const link = STORE_LINKS[os].find(({ key }) => stores[key]);
      if (link) out[os] = { os, href: stores[link.key], label: link.label, pilot: link.key !== os };
    }
    return out;
  }, [enabled, stores]);
}

"use client";
import { useCallback, useEffect, useState } from "react";
import type { OfficeReleases } from "@uniwork/core/api/endpoints/office-releases";
import { useOfficeReleases } from "@uniwork/core/office/releases-hooks";
import { channelLatests, RELEASE_CHANNELS, type ReleaseChannel } from "./manifest";

export type ReleasesStatus = "loading" | "ready" | "empty" | "error";
export interface NewVersion { channel: ReleaseChannel; version: string }
export interface Releases {
  status: ReleasesStatus;
  manifest: OfficeReleases | null;
  /** A newer `latest` a re-check found; applied only when the reader asks. */
  pending: NewVersion | null;
  apply: () => void;
  dismiss: () => void;
  retry: () => void;
}

function changed(shown: OfficeReleases, next: OfficeReleases): NewVersion | null {
  const before = channelLatests(shown);
  const after = channelLatests(next);
  const channel = RELEASE_CHANNELS.find((name) => after[name] !== undefined && after[name] !== before[name]);
  return channel ? { channel, version: after[channel]! } : null;
}

/**
 * The manifest the section shows. The first readable answer is kept as the
 * shown snapshot; a re-check that finds a newer `latest` becomes a non-modal
 * notice, and only "Tải lại" swaps it in, so the page never moves under the
 * reader. A failed or drifted re-check is silent: the page already shows a
 * good manifest. With no readable answer at all the section falls back.
 */
export function useReleases(): Releases {
  const query = useOfficeReleases();
  const [shown, setShown] = useState<OfficeReleases | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const latest = query.data ?? null;
  useEffect(() => { if (latest && !shown) setShown(latest); }, [latest, shown]);
  const manifest = shown ?? latest;
  const found = shown && latest ? changed(shown, latest) : null;
  const status: ReleasesStatus = manifest
    ? (Object.keys(manifest.channels).length === 0 ? "empty" : "ready")
    : query.isPending || query.isFetching ? "loading" : "error";
  const apply = useCallback(() => { if (latest) setShown(latest); }, [latest]);
  const dismiss = useCallback(() => { if (found) setDismissed(`${found.channel}@${found.version}`); }, [found]);
  const { refetch } = query;
  const retry = useCallback(() => { void refetch(); }, [refetch]);
  const pending = found && dismissed !== `${found.channel}@${found.version}` ? found : null;
  return { status, manifest, pending, apply, dismiss, retry };
}

/** `?channel=` as the selected channel: read after hydration, written with replaceState so a share link keeps it. */
export function useChannelParam(): [ReleaseChannel | null, (channel: ReleaseChannel) => void] {
  const [channel, setChannel] = useState<ReleaseChannel | null>(null);
  useEffect(() => {
    const read = () => {
      const value = new URLSearchParams(window.location.search).get("channel");
      setChannel(RELEASE_CHANNELS.find((name) => name === value) ?? null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const choose = useCallback((value: ReleaseChannel) => {
    const url = new URL(window.location.href);
    url.searchParams.set("channel", value);
    window.history.replaceState(window.history.state, "", url);
    setChannel(value);
  }, []);
  return [channel, choose];
}

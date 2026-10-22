"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readDesignState, type DesignState } from "./fixtures";
import { channelLatests, RELEASE_CHANNELS, type ReleaseChannel, type ReleasesManifest } from "./manifest";
import { loadManifest } from "./manifest-source";

/** A re-check at most this often: on tab focus or when the tab becomes visible again. No timers, no socket. */
export const RECHECK_MS = 10 * 60 * 1000;

export type ReleasesStatus = "loading" | "ready" | "empty" | "error";
export interface NewVersion { channel: ReleaseChannel; version: string }
export interface Releases {
  status: ReleasesStatus;
  manifest: ReleasesManifest | null;
  /** A newer `latest` a re-check found; applied only when the reader asks. */
  pending: NewVersion | null;
  apply: () => void;
  dismiss: () => void;
  retry: () => void;
}

function changed(shown: ReleasesManifest, next: ReleasesManifest): NewVersion | null {
  const before = channelLatests(shown);
  const after = channelLatests(next);
  const channel = RELEASE_CHANNELS.find((name) => after[name] !== undefined && after[name] !== before[name]);
  return channel ? { channel, version: after[channel]! } : null;
}

/**
 * The manifest, read in the browser after hydration (the server renders the
 * loading shell, so both agree). It re-checks politely while the page is open
 * and offers a newer `latest` as a non-modal notice rather than moving the
 * page under the reader.
 */
export function useReleases(): Releases {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith("vi") ? "vi" : "en";
  const [status, setStatus] = useState<ReleasesStatus>("loading");
  const [manifest, setManifest] = useState<ReleasesManifest | null>(null);
  const [next, setNext] = useState<ReleasesManifest | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const design = useRef<DesignState | null>(null);
  const shown = useRef<ReleasesManifest | null>(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    let live = true;
    design.current = readDesignState();
    if (design.current === "loading") return;
    setStatus("loading");
    loadManifest(locale, { empty: design.current === "empty", fail: design.current === "error" }).then((value) => {
      if (!live) return;
      lastCheck.current = Date.now();
      shown.current = value;
      setManifest(value);
      setStatus(Object.keys(value.channels).length === 0 ? "empty" : "ready");
    }, () => { if (live) setStatus("error"); });
    return () => { live = false; };
  }, [locale, attempt]);

  const check = useCallback(async (force: boolean) => {
    const current = shown.current;
    if (!current || (!force && Date.now() - lastCheck.current < RECHECK_MS)) return;
    lastCheck.current = Date.now();
    // A failed re-check is silent: the page already shows a good manifest.
    const value = await loadManifest(locale, { newer: design.current === "update" }).catch(() => null);
    if (value && changed(current, value)) setNext(value);
  }, [locale]);

  useEffect(() => {
    if (status !== "ready") return;
    const visible = () => { if (document.visibilityState === "visible") void check(false); };
    const focus = () => { void check(false); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", focus);
    // DESIGN-ONLY: `?state=update` shows the notice a few seconds after load, as a real re-check would.
    const demo = design.current === "update" ? window.setTimeout(() => { void check(true); }, 2500) : 0;
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", focus); window.clearTimeout(demo); };
  }, [status, check]);

  const found = next && manifest ? changed(manifest, next) : null;
  const apply = useCallback(() => { if (next) { shown.current = next; setManifest(next); setNext(null); } }, [next]);
  const dismiss = useCallback(() => { if (found) setDismissed(`${found.channel}@${found.version}`); }, [found]);
  const pending = found && dismissed !== `${found.channel}@${found.version}` ? found : null;
  return { status, manifest, pending, apply, dismiss, retry: () => setAttempt((n) => n + 1) };
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

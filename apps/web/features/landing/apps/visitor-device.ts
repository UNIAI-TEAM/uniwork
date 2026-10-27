"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DESKTOP_INSTALLER_KINDS, type DesktopOS, type DesktopPlatformGuess } from "@uniwork/core/office";
import { readBrowserPlatformGuess, UNKNOWN_PLATFORM } from "../office-platform-hint";
import type { PhoneOS } from "./catalog";

/** The phone's own store, or null off a phone. iPadOS that reports a Mac stays null. */
function phoneOf(userAgent: string): PhoneOS | null {
  return /\b(?:iphone|ipad|ipod)\b/i.test(userAgent) ? "ios" : /\bandroid\b/i.test(userAgent) ? "android" : null;
}

const noSubscription = () => () => {};

/** Read after hydration only: the server renders the desktop-first page. */
function useVisitorPhone(): PhoneOS | null {
  return useSyncExternalStore(noSubscription, () => phoneOf(navigator.userAgent), () => null);
}

export interface VisitorDevice {
  phone: PhoneOS | null;
  /** The desktop system, when the browser proves or strongly suggests one. */
  desktop: DesktopOS | null;
  guess: DesktopPlatformGuess;
  /** False until the browser has answered, so a layout that depends on the system can wait instead of jumping. */
  settled: boolean;
}

/** Where the visitor is reading from, for "Download for macOS" style labels. */
export function useVisitorDevice(): VisitorDevice {
  const phone = useVisitorPhone();
  const [guess, setGuess] = useState<DesktopPlatformGuess>(UNKNOWN_PLATFORM);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    let live = true;
    void readBrowserPlatformGuess().then((value) => { if (live) { setGuess(value); setSettled(true); } }, () => { if (live) setSettled(true); });
    return () => { live = false; };
  }, []);
  const desktop = !phone && guess.platform ? DESKTOP_INSTALLER_KINDS[guess.platform].os : null;
  return { phone, desktop, guess, settled };
}

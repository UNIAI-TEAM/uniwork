// Covers UniChat when the person is not looking at it, and locks it when they
// asked for that (Settings › Privacy & security; lib/app-lock.ts).
//
// - Away from the front (the app switcher, the notification shade, a locked
//   phone), with the app lock or screen security on: a plain cover, so the
//   app switcher's snapshot shows no conversation. Android's FLAG_SECURE and
//   iOS's app switcher protection (components/app/privacy.ts) do the same
//   natively; this cover is the part a JavaScript frame can add.
// - App lock: a cold start, and a return after the chosen time in the
//   background, show the lock screen until Face ID, a fingerprint or the
//   phone's passcode succeeds (asked at once, and again from Unlock). Only
//   while someone is signed in: the sign-in screen has nothing to hide.
//   A ringing or live call is never held behind the lock (a call answered
//   from the lock screen must connect); the lock comes back once it ends.
// Until the saved choices are known the app is covered, so a locked app never
// shows the inbox for a frame first (the read is capped, data/privacy-settings.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, StyleSheet, View, type AppStateStatus } from "react-native";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { callEngine } from "@/data/calls/call-store";
import { coversWhenAway, shouldLock } from "@/lib/app-lock";
import { callHoldsSocket } from "@/lib/call-socket";
import { authenticateOwner, usePrivacySettings } from "./privacy";

export function PrivacyGuard({ now = Date.now }: { now?: () => number }) {
  const { t } = useTranslation();
  const { settings, loaded } = usePrivacySettings();
  const signedIn = useAuthStore((s) => s.user !== null);
  const callLive = useStore(callEngine.store, (s) => callHoldsSocket(s.call));
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [locked, setLocked] = useState(false);
  const leftAt = useRef<number | null>(null);
  const coldStartChecked = useRef(false);
  const prompting = useRef(false);
  // Asked once each time the lock shows in front: a cancelled Face ID makes the app active again, which must not ask again.
  const autoPrompted = useRef(false);
  const latest = useRef(settings);
  latest.current = settings;

  // A cold start locks once the saved choices are known.
  useEffect(() => {
    if (!loaded || coldStartChecked.current) return;
    coldStartChecked.current = true;
    if (shouldLock(latest.current, null, now())) setLocked(true);
  }, [loaded, now]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setAppState(next);
      // Only the background counts as away: Face ID's own prompt, the notification shade and a call banner make the app inactive.
      if (next === "background") {
        leftAt.current = now();
        autoPrompted.current = false;
      }
      else if (next === "active" && leftAt.current !== null) {
        if (shouldLock(latest.current, leftAt.current, now())) setLocked(true);
        leftAt.current = null;
      }
    });
    return () => subscription.remove();
  }, [now]);

  // Turning the lock off in Settings unlocks too (only reachable while unlocked, so this is for consistency).
  useEffect(() => {
    if (!settings.appLock) setLocked(false);
  }, [settings.appLock]);

  const lockShown = locked && signedIn && !callLive;

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      if (await authenticateOwner(t("mobile.security.unlock_prompt"), t("common.cancel"))) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }, [t]);

  useEffect(() => {
    if (!locked) autoPrompted.current = false;
  }, [locked]);

  // Ask at once when the lock shows with the app in front; Unlock asks again after a cancel.
  useEffect(() => {
    if (!lockShown || appState !== "active" || autoPrompted.current) return;
    autoPrompted.current = true;
    void unlock();
  }, [lockShown, appState, unlock]);

  if (lockShown) {
    return (
      <View style={StyleSheet.absoluteFill} className="items-center justify-center gap-4 bg-background px-8" accessibilityViewIsModal testID="privacy-lock">
        <Text accessibilityRole="header" className="text-title2 font-display font-bold text-foreground">
          {t("mobile.security.locked_title")}
        </Text>
        <Text className="text-center text-body text-muted-foreground">{t("mobile.security.locked_body")}</Text>
        <Button className="min-h-12 rounded-full px-8" onPress={() => void unlock()}>
          <Text className="text-body font-semibold">{t("mobile.security.unlock")}</Text>
        </Button>
      </View>
    );
  }
  const covered = signedIn && (!loaded || (appState !== "active" && coversWhenAway(settings)));
  if (!covered) return null;
  return (
    <View style={StyleSheet.absoluteFill} className="items-center justify-center bg-background" accessibilityViewIsModal testID="privacy-cover">
      <Text className="text-title2 font-display font-bold text-foreground">{t("mobile.security.privacy_cover")}</Text>
    </View>
  );
}

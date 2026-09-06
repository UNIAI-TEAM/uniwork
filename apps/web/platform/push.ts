"use client";

import { registerPushAdapter, type PushAdapter, type PushPermission } from "@uniwork/core/platform";
import type { PushSubscriptionBody } from "@uniwork/core/types";

/**
 * The web half of Web Push: the only place that touches
 * navigator.serviceWorker and PushManager. Importing this module registers
 * the adapter; on SSR or an engine without push it registers nothing and
 * the settings screen hides the option.
 */
function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

function toBody(sub: PushSubscription): PushSubscriptionBody {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
  };
}

/** base64url VAPID key → the Uint8Array PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const webPush: PushAdapter = {
  permission(): PushPermission {
    return supported() ? Notification.permission : "unsupported";
  },
  async requestPermission() {
    if (!supported()) return "unsupported";
    if (Notification.permission !== "default") return Notification.permission;
    return Notification.requestPermission();
  },
  async current() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    return sub ? toBody(sub) : null;
  },
  async subscribe(publicKey) {
    const reg = await registration();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    return toBody(sub);
  },
  async unsubscribe() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return null;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    return endpoint;
  },
};

if (supported()) registerPushAdapter(webPush);

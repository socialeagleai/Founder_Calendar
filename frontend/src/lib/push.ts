/**
 * Browser-side Web Push.
 *
 * Every function here touches APIs that do not exist during SSR. This app is
 * server-rendered, so `Notification`, `navigator.serviceWorker`, `PushManager`
 * and `atob` are all undefined on the server - reading them during render throws
 * there and 500s the page, not just the browser. So: nothing here runs at module
 * scope, callers invoke it from effects, and `pushSupported()` is called inside
 * an effect and stored in state rather than computed during render (which would
 * also hydrate-mismatch).
 */

import { api } from "./api";

/** Whether this browser can do web push at all. Call from an effect only. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The current OS-level permission, or "unsupported". Effect-only. */
export function pushPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * VAPID keys are base64url; PushManager wants raw bytes. Browsers give us no
 * helper for this, so it's the standard hand-rolled decode.
 *
 * Built over an explicit ArrayBuffer rather than Uint8Array.from(): the latter
 * types as Uint8Array<ArrayBufferLike>, which doesn't satisfy BufferSource
 * because it might be backed by a SharedArrayBuffer.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // register() resolves before the worker is active; `ready` is what guarantees
  // we can actually subscribe.
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/**
 * Ask permission, subscribe this browser, and register it with the backend.
 * Returns true when push is live. Throws with a human-readable reason so the
 * caller can toast it.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) throw new Error("This browser doesn't support notifications");

  const config = await api.getPushConfig();
  if (!config.enabled || !config.publicKey) {
    throw new Error("Push isn't configured on the server yet");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    // "denied" is sticky - the browser won't ask again, so say so rather than
    // let them click a dead button forever.
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser's site settings."
        : "Notification permission wasn't granted",
    );
  }

  const reg = await registration();
  // Reuse an existing subscription if there is one; re-subscribing with a
  // different key throws rather than replacing it.
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));

  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys?.auth) throw new Error("Subscription is missing its keys");
  await api.subscribePush({
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
  return true;
}

/** Unsubscribe this browser and tell the backend to forget it. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  // Tell the server first: if unsubscribe() succeeds and the POST fails, the
  // backend keeps pushing to an endpoint nobody is listening on.
  await api.unsubscribePush(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

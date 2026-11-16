/** Browser side of Web Push: support detection, permission and subscribing this device. */
import { post } from '../api';

export type DeviceState = 'unsupported' | 'install' | 'blocked' | 'off' | 'on';

const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** This device: iPhone needs the Home-Screen app first; otherwise permission + a live subscription known to the server. */
export async function deviceState(knownEndpoints: string[]): Promise<DeviceState> {
  if (ios() && !standalone()) return 'install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const sub = Notification.permission === 'granted' ? await currentSub() : null;
  return sub && knownEndpoints.includes(sub.endpoint) ? 'on' : 'off';
}

const keyBytes = (b64u: string) => Uint8Array.from(atob(b64u.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Asks for permission (call from a click) and registers this device. Returns the resulting state. */
export async function enablePush(publicKey: string): Promise<DeviceState> {
  if (ios() && !standalone()) return 'install';
  if (!supported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey ?? new ArrayBuffer(0)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
    await sub.unsubscribe(); // server keys changed
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const j = sub.toJSON();
  await post('/api/reminders/devices', { endpoint: j.endpoint, keys: j.keys, label: deviceLabel() });
  return 'on';
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Linux';
  const br = /edg\//i.test(ua) ? 'Edge' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : 'Safari';
  return `${os} · ${br}`;
}

/** Endpoint of this browser's subscription, to mark "this device" in the list. */
export const thisEndpoint = async () => (supported() ? ((await currentSub())?.endpoint ?? null) : null);

/** Sign-out: drop this browser's subscription here and on the server (shared devices stop getting the user's reminders). */
export async function unsubscribeThisDevice() {
  try {
    const sub = supported() ? await currentSub() : null;
    if (!sub) return;
    await post('/api/reminders/devices/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } catch {
    /* best effort */
  }
}

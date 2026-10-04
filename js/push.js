// 휴대폰 알림 켜기/끄기 (웹 푸시)
// 이 휴대폰의 '알림 받을 주소'와 받을 시간만 알림 서버에 보냅니다. 이름·연락처 등은 보내지 않습니다.
import { PUSH_API } from './config.js';

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const pushConnected = () => Boolean(PUSH_API); // 알림 서버 연결 여부
export const browserSupportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushSupported = () => pushConnected() && browserSupportsPush();

// 서버 연결 전: 알림 허용만 미리 받아 두기 (사용자가 누를 때만 물어볼 수 있음)
export async function askPermissionOnly() {
  if (!browserSupportsPush()) throw new Error('이 브라우저에서는 알림을 받을 수 없습니다');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림이 허용되지 않았습니다. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요');
}

// 앱을 열 때: 미리 알림을 켜 둔 사람은 서버가 연결되면 자동으로 등록
export async function autoConnect(hour) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const sub = await currentSubscription();
  if (sub) return true;
  await enablePush(hour);
  return true;
}

function keyToBytes(b64u) {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function post(path, body) {
  const res = await fetch(`${PUSH_API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `알림 서버 응답 오류 (${res.status})`);
  return data;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(hour) {
  if (!pushSupported()) throw new Error('이 브라우저는 알림을 지원하지 않습니다');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림이 허용되지 않았습니다. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요');
  const { publicKey } = await (await fetch(`${PUSH_API}/vapid-public-key`)).json();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  await post('/subscribe', { subscription: sub.toJSON(), hour });
}

export async function updateHour(hour) {
  const sub = await currentSubscription();
  if (sub) await post('/subscribe', { subscription: sub.toJSON(), hour });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

export async function sendTest() {
  const sub = await currentSubscription();
  if (!sub) throw new Error('먼저 알림을 켜 주세요');
  return post('/test', { endpoint: sub.endpoint });
}

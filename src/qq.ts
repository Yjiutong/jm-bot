import { readJson, type Env } from './env';

const PKCS8_ED25519 = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

const DEFAULT_API_BASE = 'https://api.bot.qq.com';
const DEFAULT_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';

let verifyKey: CryptoKey | null = null;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signingKey(env: Env): Promise<CryptoKey> {
  const seed = new TextEncoder().encode(env.QQ_CLIENT_SECRET).subarray(0, 32);
  const der = new Uint8Array(PKCS8_ED25519.length + 32);
  der.set(PKCS8_ED25519);
  der.set(seed, PKCS8_ED25519.length);
  return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']);
}

async function publicVerifyKey(env: Env): Promise<CryptoKey> {
  if (verifyKey) return verifyKey;
  const key = await signingKey(env);
  const jwk = (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey;
  verifyKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return verifyKey;
}

/** 回调地址校验（op=13）要求返回的签名。 */
export async function signCallback(env: Env, eventTs: string, plainToken: string): Promise<string> {
  const key = await signingKey(env);
  return toHex(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(`${eventTs}${plainToken}`)));
}

/** 校验事件推送的签名，确认请求确实来自开放平台。 */
export async function verifyCallback(
  env: Env,
  signature: string,
  timestamp: string,
  body: string,
): Promise<boolean> {
  try {
    const key = await publicVerifyKey(env);
    const raw = Uint8Array.from(signature.match(/../g) ?? [], (h) => parseInt(h, 16));
    return await crypto.subtle.verify(
      'Ed25519',
      key,
      raw,
      new TextEncoder().encode(`${timestamp}${body}`),
    );
  } catch {
    return false;
  }
}

export async function accessToken(env: Env): Promise<string> {
  const key = 'state/qq-token.json';
  const cached = await readJson<{ token: string; expiresAt: number }>(env, key);
  if (cached?.token && cached.expiresAt - Date.now() > 60_000) return cached.token;

  const resp = await fetch(env.QQ_TOKEN_URL || DEFAULT_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ app_id: env.QQ_APP_ID, client_secret: env.QQ_CLIENT_SECRET }),
  });
  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`获取 access_token 失败: ${JSON.stringify(data).slice(0, 200)}`);

  await env.CACHE.put(
    key,
    JSON.stringify({ token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000 }),
    { httpMetadata: { contentType: 'application/json' } },
  );
  return data.access_token;
}

export interface QqMessageEvent {
  id?: string;
  content?: string;
  group_openid?: string;
  openid?: string;
  /** 单聊事件（C2C_MESSAGE_CREATE）的用户标识在 user.openid 里，不在顶层 */
  user?: { id?: string; openid?: string };
}

/** 群聊被动回复窗口只有 5 分钟、5 次，超时或超频会拿到 40034128。 */
export async function reply(env: Env, event: QqMessageEvent, text: string): Promise<string> {
  if (!event.id) return '事件缺少 id，无法被动回复';

  const openId = event.user?.openid || event.openid || '';
  const target = event.group_openid
    ? `/v2/groups/${event.group_openid}/messages`
    : openId
      ? `/v2/users/${openId}/messages`
      : '';
  if (!target) return '事件里没有 group_openid / user.openid';

  const resp = await fetch(`${env.QQ_API_BASE || DEFAULT_API_BASE}${target}`, {
    method: 'POST',
    headers: {
      authorization: `QQBot ${await accessToken(env)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 0,
      content: text.slice(0, 500),
      msg_id: event.id,
      msg_seq: 1,
    }),
  });

  const body = await resp.text();
  return resp.ok ? `已回复: ${body.slice(0, 120)}` : `回复失败 ${resp.status}: ${body.slice(0, 200)}`;
}

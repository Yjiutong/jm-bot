import { fetchAlbum, fetchChapter, fetchImageBytes, imageNum } from './jm';
import { renderReader } from './reader';
import { reply, signCallback, verifyCallback, type QqMessageEvent } from './qq';
import { readJson, type AlbumMeta, type Chapter, type Env } from './env';

const ID = /^\d{4,12}$/;
const NAME = /^[\w.-]+\.(jpg|jpeg|png|gif|webp)$/i;
const DEFAULT_PREVIEW_HOURS = '24';

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function previewHours(env: Env): number {
  return Math.max(1, Number(env.PREVIEW_HOURS ?? DEFAULT_PREVIEW_HOURS));
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function linkSig(env: Env, albumId: string, exp: string): Promise<string> {
  if (!env.LINK_SECRET) {
    throw new Error('未配置 LINK_SECRET：请在 Worker 的 Settings → Variables and Secrets 里以「密钥」类型添加（明文变量会被 wrangler 部署清空）');
  }
  return hmac(env.LINK_SECRET, `${albumId}:${exp}`);
}

async function previewLink(env: Env, albumId: string, baseUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + previewHours(env) * 3600;
  const sig = await linkSig(env, albumId, String(exp));
  return `${baseUrl}/p/${albumId}?e=${exp}&s=${sig}`;
}

async function checkAccess(env: Env, albumId: string, params: URLSearchParams): Promise<string | null> {
  const exp = params.get('e') ?? '';
  const sig = params.get('s') ?? '';
  if (!/^\d+$/.test(exp)) return '缺少过期参数';
  if (Number(exp) * 1000 < Date.now()) return '链接已过期';
  if (sig !== (await linkSig(env, albumId, exp))) return '签名不匹配';
  return null;
}

async function ensureMeta(env: Env, albumId: string): Promise<AlbumMeta> {
  const key = `albums/${albumId}/meta.json`;
  const cached = await readJson<AlbumMeta>(env, key);
  if (cached?.album_id) return cached;

  const meta = await fetchAlbum(albumId);
  await env.CACHE.put(key, JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } });
  return meta;
}

async function ensureChapter(env: Env, meta: AlbumMeta, photoId: string): Promise<Chapter> {
  const key = `albums/${meta.album_id}/chapter/${photoId}.json`;
  const cached = await readJson<Chapter>(env, key);
  if (cached?.photo_id) return cached;

  const chapter = await fetchChapter(meta, photoId);
  await env.CACHE.put(key, JSON.stringify(chapter), { httpMetadata: { contentType: 'application/json' } });
  return chapter;
}

async function serveImage(env: Env, key: string, photoId: string, fileName: string): Promise<Response> {
  const cached = await env.CACHE.get(key);
  if (cached) {
    return new Response(cached.body, {
      headers: {
        'content-type': cached.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  const image = await fetchImageBytes(photoId, fileName);
  await env.CACHE.put(key, image.bytes, { httpMetadata: { contentType: image.contentType } });
  return new Response(image.bytes, {
    headers: { 'content-type': image.contentType, 'cache-control': 'private, max-age=3600' },
  });
}

function stripSuffix(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function parseAlbumId(content: string): string {
  const cleaned = content.replace(/@[^\s]+/g, ' ').trim();
  return /^\d{4,12}$/.test(cleaned) ? cleaned : '';
}

/**
 * 链接基址不需要单独配置：没设 PUBLIC_BASE_URL 时直接取回调请求自己的来源，
 * 后台绑的是哪个域名就是哪个，省掉一次改配置。
 */
function resolveBaseUrl(env: Env, request: Request): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

/**
 * 回调诊断：只记录判断问题所需的非身份字段（事件类型、验签结果、解析出的 JM 号、回复结果），
 * 不记录消息原文，也不记录 openid。
 */
async function recordCallback(env: Env, trace: Record<string, unknown>): Promise<void> {
  try {
    await env.CACHE.put('state/last-callback.json', JSON.stringify({ ...trace, at: new Date().toISOString() }));
  } catch {
    // 诊断本身不该影响收消息
  }
}

async function handleQqEvent(env: Env, event: QqMessageEvent, baseUrl: string): Promise<string> {
  const albumId = parseAlbumId(event.content ?? '');
  if (!albumId) return await reply(env, event, '用法：直接发一个禁漫 JM 号，例如 350234');

  try {
    const meta = await ensureMeta(env, albumId);
    const link = await previewLink(env, meta.album_id, baseUrl);
    const head = [
      meta.title,
      `${meta.authors.join(' / ')}｜${meta.episodes.length} 话 ${meta.page_count} 页`,
      meta.tags.length > 0 ? `标签 ${meta.tags.slice(0, 6).join(' ')}` : '',
    ].filter(Boolean);

    const first = await reply(env, event, [...head, link].join('\n'));
    if (first.startsWith('已回复')) return first;

    // 带链接失败、去掉链接就成功 → 域名没进 QQ 的消息 URL 白名单
    const retry = await reply(env, event, head.join('\n'));
    return `${first} → 去掉链接重试: ${retry}`;
  } catch (e) {
    return await reply(env, event, `抓取失败：${reason(e)}`.slice(0, 400));
  }
}

async function cryptoSelfTest(env: Env): Promise<Response> {
  const result: Record<string, string> = {};
  try {
    const sig = await signCallback(env, '1725442341', 'Arq0D5A61EgUu4OxUvOp');
    result.ed25519_sign = `ok (${sig.length} hex)`;
    result.ed25519_verify = (await verifyCallback(env, sig, '1725442341', 'Arq0D5A61EgUu4OxUvOp'))
      ? 'ok'
      : 'FAILED';
  } catch (e) {
    result.ed25519 = `FAILED: ${reason(e)}`;
  }
  try {
    await env.CACHE.put('state/selftest.txt', 'ok');
    result.r2 = (await env.CACHE.get('state/selftest.txt'))?.body ? 'ok' : 'read failed';
  } catch (e) {
    result.r2 = `FAILED: ${reason(e)}`;
  }
  return json(result);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const seg = url.pathname.split('/').filter(Boolean);

    try {
      if (seg.length === 0) {
        return new Response('jm-bot worker：/p/<JM号> 阅读页，/qq/callback 回调，/cryptotest 自检', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }

      if (seg[0] === 'cryptotest') return await cryptoSelfTest(env);

      if (seg[0] === 'qq' && seg[1] === 'callback') {
        if (request.method !== 'POST') return new Response('POST only', { status: 405 });

        const body = await request.text();
        const payload = JSON.parse(body) as { op?: number; t?: string; d?: QqMessageEvent };
        const trace: Record<string, unknown> = { op: payload.op ?? null, event: payload.t ?? null };

        const signature = request.headers.get('x-signature-ed25519') ?? '';
        const timestamp = request.headers.get('x-signature-timestamp') ?? '';
        if (!signature) {
          await recordCallback(env, { ...trace, outcome: '缺少 x-signature-ed25519 头，已拒绝' });
          return new Response('missing signature', { status: 401 });
        }

        if (payload.op === 13) {
          const d = (payload.d ?? {}) as { plain_token?: string; event_ts?: string };
          await recordCallback(env, { ...trace, outcome: '回调地址校验，已签名应答' });
          return json({
            plain_token: d.plain_token,
            signature: await signCallback(env, d.event_ts ?? '', d.plain_token ?? ''),
          });
        }

        if (!(await verifyCallback(env, signature, timestamp, body))) {
          await recordCallback(env, {
            ...trace,
            outcome: '验签失败已拒绝 —— 若这是真实事件，说明事件签名约定与平台不一致',
          });
          return new Response('invalid signature', { status: 401 });
        }

        const event = payload.d ?? {};
        trace.album_id = parseAlbumId(event.content ?? '');
        // 只记录字段名，不记录任何取值，避免 openid / 消息原文进诊断
        trace.fields = Object.keys(event).join(',');
        ctx.waitUntil(
          handleQqEvent(env, event, resolveBaseUrl(env, request))
            .then((result) => recordCallback(env, { ...trace, outcome: String(result).slice(0, 200) }))
            .catch((e) => recordCallback(env, { ...trace, outcome: `处理异常: ${reason(e)}`.slice(0, 200) })),
        );
        return json({ op: 12 });
      }

      if (seg[0] === 'qq' && seg[1] === 'last') {
        const last = await readJson<Record<string, unknown>>(env, 'state/last-callback.json');
        return json(last ?? { note: '还没收到任何回调 —— 说明 QQ 侧没有往这个地址推事件' });
      }

      if (seg[0] === 'p' && seg.length === 2 && ID.test(seg[1])) {
        const albumId = seg[1];
        const denied = await checkAccess(env, albumId, url.searchParams);
        if (denied) return new Response(denied, { status: 403 });

        const meta = await ensureMeta(env, albumId);
        const index = Math.min(Math.max(Number(url.searchParams.get('ep') ?? '0') || 0, 0), meta.episodes.length - 1);
        const episode = meta.episodes[index];
        const chapter = await ensureChapter(env, meta, episode.photo_id);
        const query = url.searchParams;

        const nums = chapter.images.map((name) =>
          name.toLowerCase().endsWith('.gif')
            ? 0
            : imageNum(meta.scramble_id, chapter.photo_id, stripSuffix(name)) || 0,
        );

        return new Response(
          renderReader(meta, chapter, {
            chapterIndex: index,
            nums,
            exp: query.get('e') ?? '',
            sig: query.get('s') ?? '',
            ttlHours: previewHours(env),
          }),
          { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
        );
      }

      if (seg[0] === 'i' && seg.length === 4 && ID.test(seg[1]) && ID.test(seg[2]) && NAME.test(seg[3])) {
        const albumId = seg[1];
        const photoId = seg[2];
        const fileName = decodeURIComponent(seg[3]);
        const denied = await checkAccess(env, albumId, url.searchParams);
        if (denied) return new Response(denied, { status: 403 });

        const meta = await ensureMeta(env, albumId);
        const chapter = await ensureChapter(env, meta, photoId);
        if (!chapter.images.includes(fileName)) return new Response('not found', { status: 404 });

        return await serveImage(env, `albums/${albumId}/img/${photoId}/${fileName}`, photoId, fileName);
      }

      return new Response('not found', { status: 404 });
    } catch (e) {
      return new Response(`请求失败: ${reason(e)}`, { status: 502 });
    }
  },
};

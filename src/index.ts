import { buildDaily, coverKey, coverSourcePath, dayKey, isQueryDay, readDaily, SHELF_WINDOW_DAYS } from './daily';
import { coverBytes, fetchAlbum, fetchChapter, fetchImageBytes, imageNum } from './jm';
import { renderReader } from './reader';
import { renderHome, renderShelf } from './shelf';
import { reply, signCallback, verifyCallback, type QqMessageEvent } from './qq';
import { readJson, type AlbumMeta, type Chapter, type Env } from './env';

const ID = /^\d{4,12}$/;
const NAME = /^[\w.-]+\.(jpg|jpeg|png|gif|webp)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_KEYWORDS = new Map([
  ['今日更新', 0],
  ['今天更新', 0],
  ['最新', 0],
  ['昨日更新', 1],
  ['昨天更新', 1],
  ['前日更新', 2],
  ['前天更新', 2],
]);
const SHELF_LABELS = ['今日更新', '昨日更新', '前日更新'];

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function previewHours(env: Env): number {
  return Math.max(1, Number(env.PREVIEW_HOURS ?? '24'));
}

/** CryptoKey 每个隔离环境只导入一次：书架页一次要签二十多条链接，重复导入会吃掉 CPU 额度。 */
let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function signKey(env: Env): Promise<CryptoKey> {
  if (!env.LINK_SECRET) {
    throw new Error('未配置 LINK_SECRET：请在 Worker 的 Settings → Variables and Secrets 里以「密钥」类型添加（明文变量会被 wrangler 部署清空）');
  }
  if (cachedKey?.secret !== env.LINK_SECRET) {
    cachedKey = {
      secret: env.LINK_SECRET,
      key: await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    };
  }
  return cachedKey.key;
}

async function ticket(env: Env, scope: string, exp: string): Promise<string> {
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', await signKey(env), new TextEncoder().encode(`${scope}:${exp}`)),
  );
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function expiring(env: Env): string {
  return String(Math.floor(Date.now() / 1000) + previewHours(env) * 3600);
}

async function checkTicket(env: Env, scope: string, params: URLSearchParams): Promise<string | null> {
  const exp = params.get('e') ?? '';
  const sig = params.get('s') ?? '';
  if (!/^\d+$/.test(exp)) return '缺少过期参数';
  if (Number(exp) * 1000 < Date.now()) return '链接已过期';
  if (sig !== (await ticket(env, scope, exp))) return '签名不匹配';
  return null;
}

/** 返回 `e=..&s=..`（不含前导符号），由调用方决定拼 `?` 还是 `&`。 */
function queryOf(params: URLSearchParams): string {
  return `e=${encodeURIComponent(params.get('e') ?? '')}&s=${encodeURIComponent(params.get('s') ?? '')}`;
}

/** 书架票据按日期分档，今天的票不能拿去访问昨天的书架。 */
function shelfScope(date: string): string {
  return `daily:${date}`;
}

async function shelfLink(env: Env, date: string, base = ''): Promise<string> {
  const exp = expiring(env);
  return `${base}/daily/${date}?e=${exp}&s=${await ticket(env, shelfScope(date), exp)}`;
}

async function shelfTabs(env: Env, current: string): Promise<{ label: string; date: string; href: string; current: boolean }[]> {
  const tabs = [];
  for (let offset = 0; offset < SHELF_WINDOW_DAYS; offset++) {
    const date = dayKey(offset);
    tabs.push({ label: SHELF_LABELS[offset] ?? date, date, href: await shelfLink(env, date), current: date === current });
  }
  return tabs;
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

async function serveImage(env: Env, key: string, source: () => Promise<{ bytes: ArrayBuffer; contentType: string }>): Promise<Response> {
  const cached = await env.CACHE.get(key);
  if (cached) {
    return new Response(cached.body, {
      headers: {
        'content-type': cached.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, max-age=3600',
      },
    });
  }

  const image = await source();
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

function resolveBaseUrl(env: Env, request: Request): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

async function recordCallback(env: Env, trace: Record<string, unknown>): Promise<void> {
  try {
    await env.CACHE.put('state/last-callback.json', JSON.stringify({ ...trace, at: new Date().toISOString() }));
  } catch {
    // 诊断本身不该影响收消息
  }
}

async function handleQqEvent(env: Env, event: QqMessageEvent, baseUrl: string): Promise<string> {
  const content = (event.content ?? '').replace(/@[^\s]+/g, ' ').trim();
  const albumId = parseAlbumId(event.content ?? '');
  const dayOffset = DAILY_KEYWORDS.get(content);

  if (!albumId && dayOffset === undefined) {
    return await reply(env, event, '用法：发一个禁漫 JM 号（例如 350234），或发「今日更新」「昨日更新」「前日更新」看书架');
  }

  try {
    if (!albumId) {
      const label = SHELF_LABELS[dayOffset ?? 0] ?? '更新书架';
      const date = dayKey(dayOffset ?? 0);
      const index = await readDaily(env, date);
      if (!index) return await reply(env, event, `${label}还没有生成（${date}）`);
      return await reply(env, event, `${label} ${index.items.length} 本 · ${date}\n${await shelfLink(env, date, baseUrl)}`);
    }

    const meta = await ensureMeta(env, albumId);
    const exp = expiring(env);
    const link = `${baseUrl}/p/${meta.album_id}?e=${exp}&s=${await ticket(env, meta.album_id, exp)}`;
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
    result.ed25519_verify = (await verifyCallback(env, sig, '1725442341', 'Arq0D5A61EgUu4OxUvOp')) ? 'ok' : 'FAILED';
  } catch (e) {
    result.ed25519 = `FAILED: ${reason(e)}`;
  }
  try {
    await env.CACHE.put('state/selftest.txt', 'ok');
    result.r2 = (await env.CACHE.get('state/selftest.txt'))?.body ? 'ok' : 'read failed';
  } catch (e) {
    result.r2 = `FAILED: ${reason(e)}`;
  }
  try {
    const index = await readDaily(env);
    result.daily = index ? `ok (${index.items.length} 本, ${index.date})` : 'empty（今天还没抓到数据）';
  } catch (e) {
    result.daily = `FAILED: ${reason(e)}`;
  }
  return json(result);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const seg = url.pathname.split('/').filter(Boolean);

    try {
      if (seg.length === 0) {
        const index = await readDaily(env);
        return html(renderHome(await shelfLink(env, dayKey()), index?.items.length ?? 0, previewHours(env)));
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
          await recordCallback(env, { ...trace, outcome: '验签失败已拒绝 —— 若这是真实事件，说明事件签名约定与平台不一致' });
          return new Response('invalid signature', { status: 401 });
        }

        const event = payload.d ?? {};
        trace.album_id = parseAlbumId(event.content ?? '');
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

      if (seg[0] === 'daily' && (seg.length === 1 || (seg.length === 2 && DATE.test(seg[1])))) {
        const date = seg.length === 2 ? seg[1] : dayKey();
        if (!isQueryDay(date)) return new Response(`只能查询最近 ${SHELF_WINDOW_DAYS} 天的书架`, { status: 410 });

        const denied = await checkTicket(env, shelfScope(date), url.searchParams);
        if (denied) return new Response(denied, { status: 403 });

        const index = await readDaily(env, date);
        if (!index) return new Response(`那天的书架不存在（${date}）：当天没生成，或已超过保留期`, { status: 404 });

        const exp = url.searchParams.get('e') ?? '';
        const entries = await Promise.all(
          index.items.map(async (item) => ({
            album_id: item.album_id,
            title: item.title,
            author: item.author,
            href: `/p/${item.album_id}?e=${exp}&s=${await ticket(env, item.album_id, exp)}`,
            cover: `${coverSourcePath(index.date, item.album_id)}?${queryOf(url.searchParams)}`,
          })),
        );
        return html(renderShelf(index.date, entries, previewHours(env), await shelfTabs(env, index.date)));
      }

      if (seg[0] === 'dc' && seg.length === 3 && DATE.test(seg[1]) && ID.test(seg[2].replace(/\.jpg$/, '')) && seg[2].endsWith('.jpg')) {
        const date = seg[1];
        const albumId = seg[2].slice(0, -4);
        if (!isQueryDay(date)) return new Response('书架已过期', { status: 410 });

        const denied = await checkTicket(env, shelfScope(date), url.searchParams);
        if (denied) return new Response(denied, { status: 403 });

        return await serveImage(env, coverKey(date, albumId), () => coverBytes(albumId));
      }

      if (seg[0] === 'p' && seg.length === 2 && ID.test(seg[1])) {
        const albumId = seg[1];
        const denied = await checkTicket(env, albumId, url.searchParams);
        if (denied) return new Response(denied, { status: 403 });

        const meta = await ensureMeta(env, albumId);
        const index = Math.min(Math.max(Number(url.searchParams.get('ep') ?? '0') || 0, 0), meta.episodes.length - 1);
        const chapter = await ensureChapter(env, meta, meta.episodes[index].photo_id);
        const nums = chapter.images.map((name) =>
          name.toLowerCase().endsWith('.gif') ? 0 : imageNum(meta.scramble_id, chapter.photo_id, stripSuffix(name)) || 0,
        );

        return html(
          renderReader(meta, chapter, {
            chapterIndex: index,
            nums,
            query: queryOf(url.searchParams),
            ttlHours: previewHours(env),
          }),
        );
      }

      if (seg[0] === 'i' && seg.length === 4 && ID.test(seg[1]) && ID.test(seg[2]) && NAME.test(seg[3])) {
        const albumId = seg[1];
        const photoId = seg[2];
        const fileName = decodeURIComponent(seg[3]);
        const denied = await checkTicket(env, albumId, url.searchParams);
        if (denied) return new Response(denied, { status: 403 });

        const meta = await ensureMeta(env, albumId);
        const chapter = await ensureChapter(env, meta, photoId);
        if (!chapter.images.includes(fileName)) return new Response('not found', { status: 404 });

        return await serveImage(env, `albums/${albumId}/img/${photoId}/${fileName}`, () => fetchImageBytes(photoId, fileName));
      }

      return new Response('not found', { status: 404 });
    } catch (e) {
      return new Response(`请求失败: ${reason(e)}`, { status: 502 });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      buildDaily(env)
        .then((index) => console.log(`每日书架 ${index.date}：${index.items.length} 本`))
        .catch((e) => console.error('每日书架构建失败:', reason(e))),
    );
  },
};

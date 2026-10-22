import { decodeApiData, md5hex, signToken } from './crypto';
import type { AlbumMeta, Chapter } from './env';

const TOKEN_SECRET = '185Hcomic3PAPP7R';
// /chapter_view_template 用的密钥不同，用错会直接 403
const TOKEN_SECRET_2 = '18comicAPPContent';
const APP_VERSION = '2.1.7';

const API_HOSTS = ['www.cdnhjk.net', 'www.cdngwc.cc', 'www.cdngwc.net', 'www.cdngwc.club'];
const IMAGE_HOSTS = [
  'cdn-msp.jmapiproxy1.cc',
  'cdn-msp.jmapiproxy2.cc',
  'cdn-msp2.jmapiproxy2.cc',
  'cdn-msp3.jmapiproxy2.cc',
  'cdn-msp.jmapinodeudzn.net',
  'cdn-msp3.jmapinodeudzn.net',
];

const UA =
  'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36';

let cookie = '';
let cookieAt = 0;

function apiHeaders(ts: number, secret = TOKEN_SECRET): Record<string, string> {
  return {
    'user-agent': UA,
    'accept-encoding': 'gzip, deflate',
    token: signToken(ts, secret),
    tokenparam: `${ts},${APP_VERSION}`,
  };
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

async function settingCookie(): Promise<string> {
  if (cookie && Date.now() - cookieAt < 3600_000) return cookie;
  const ts = Math.floor(Date.now() / 1000);
  for (const host of API_HOSTS) {
    try {
      const resp = await fetch(`https://${host}/setting`, { headers: apiHeaders(ts) });
      const value = (resp.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
      if (resp.status === 200 && value) {
        cookie = value;
        cookieAt = Date.now();
        return cookie;
      }
    } catch {
      // 换下一个域名
    }
  }
  return cookie;
}

async function apiData(path: string): Promise<Record<string, unknown>> {
  const ts = Math.floor(Date.now() / 1000);
  const headers = { ...apiHeaders(ts) };
  const c = await settingCookie();
  if (c) headers.cookie = c;

  const fails: string[] = [];
  for (const host of API_HOSTS) {
    try {
      const resp = await fetch(`https://${host}${path}`, { headers });
      if (resp.status !== 200) {
        fails.push(`${host}=${resp.status}`);
        continue;
      }
      const envelope = (await resp.json()) as { data?: unknown };
      if (typeof envelope.data === 'string') return await decodeApiData(envelope.data, ts);
      if (envelope.data && typeof envelope.data === 'object') return envelope.data as Record<string, unknown>;
      fails.push(`${host}=空data`);
    } catch (e) {
      fails.push(`${host}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`禁漫接口全部失败 ${path} → ${fails.join(' | ')}`);
}

async function fetchScrambleId(photoId: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const headers = { ...apiHeaders(ts, TOKEN_SECRET_2) };
  if (cookie) headers.cookie = cookie;
  const path = `/chapter_view_template?id=${photoId}&mode=vertical&page=0&app_img_shunt=1&express=off&v=${ts}`;

  for (const host of API_HOSTS) {
    try {
      const resp = await fetch(`https://${host}${path}`, { headers });
      if (resp.status !== 200) continue;
      const matched = /var scramble_id = (\d+);/.exec(await resp.text());
      if (matched) return matched[1];
    } catch {
      // 换下一个域名
    }
  }
  return '220980';
}

export async function fetchAlbum(albumId: string): Promise<AlbumMeta> {
  const data = await apiData(`/album?id=${albumId}&lang=zh`);
  const series = (data.series ?? []) as { id: string; name?: string; sort: string }[];

  let episodes: AlbumMeta['episodes'] = series.map((s) => ({
    photo_id: String(s.id),
    index: Number(s.sort),
    title: String(s.name ?? ''),
  }));
  episodes.sort((a, b) => a.index - b.index);
  if (episodes.length === 0) episodes = [{ photo_id: albumId, index: 1, title: String(data.name ?? '') }];

  return {
    album_id: String(data.id ?? albumId),
    title: String(data.name ?? ''),
    authors: ((data.author ?? []) as unknown[]).map(String),
    tags: ((data.tags ?? []) as unknown[]).map(String),
    description: String(data.description ?? ''),
    page_count: Number(data.total_photos ?? 0),
    pub_date: data.addtime ? new Date(Number(data.addtime) * 1000).toISOString().slice(0, 10) : '',
    views: String(data.total_views ?? ''),
    scramble_id: await fetchScrambleId(episodes[0].photo_id),
    fetched_at: Date.now(),
    episodes,
  };
}

export async function fetchChapter(meta: AlbumMeta, photoId: string): Promise<Chapter> {
  const data = await apiData(`/chapter?id=${photoId}&lang=zh`);
  const series = (data.series ?? []) as { id: string; sort: string }[];
  const self = series.find((s) => String(s.id) === photoId);
  const known = meta.episodes.find((e) => e.photo_id === photoId);

  return {
    photo_id: photoId,
    index: self ? Number(self.sort) : (known?.index ?? 1),
    title: known?.title || String(data.name ?? ''),
    images: ((data.images ?? []) as unknown[]).map(String),
    domain: pick(IMAGE_HOSTS),
  };
}

/** 图片被切成几条横带；与 jmcomic 的 JmImageTool.get_num 保持一致。 */
export function imageNum(scrambleId: string, photoId: string, fileName: string): number {
  const sid = Number(scrambleId);
  const aid = Number(photoId);
  if (aid < sid) return 0;
  if (aid < 268850) return 10;

  const x = aid < 421926 ? 10 : 8;
  const hex = md5hex(`${photoId}${fileName}`);
  return (hex.charCodeAt(hex.length - 1) % x) * 2 + 2;
}

export function imageUrl(domain: string, photoId: string, fileName: string): string {
  return `https://${domain}/media/photos/${photoId}/${fileName}`;
}

export async function fetchImageBytes(url: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const resp = await fetch(url, {
    headers: {
      'user-agent': UA,
      referer: 'https://18comic.vip/',
      'x-requested-with': 'com.JMComic3.app',
    },
  });
  if (!resp.ok || resp.status !== 200) throw new Error(`图片获取失败 ${resp.status}: ${url}`);
  const bytes = await resp.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error(`图片响应为空: ${url}`);
  return { bytes, contentType: resp.headers.get('content-type') ?? 'image/jpeg' };
}

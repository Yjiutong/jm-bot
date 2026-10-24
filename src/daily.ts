import { fetchLatest } from './jm';
import { readJson, type Env } from './env';

export interface DailyItem {
  album_id: string;
  title: string;
  author: string;
}

export interface DailyIndex {
  date: string;
  built_at: number;
  items: DailyItem[];
}

const ZONE = 'Asia/Shanghai';

/** 「当天」按北京时间算，和读者的作息一致，而不是 UTC。 */
export function dayKey(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() - offsetDays * 86_400_000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dailyLimit(env: Env): number {
  return Math.min(80, Math.max(1, Number(env.DAILY_LIMIT ?? '24')));
}

function indexKey(date: string): string {
  return `daily/${date}/index.json`;
}

export function coverKey(date: string, albumId: string): string {
  return `daily/${date}/covers/${albumId}.jpg`;
}

export function coverSourcePath(date: string, albumId: string): string {
  return `/dc/${date}/${albumId}.jpg`;
}

async function purgeDate(env: Env, date: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  do {
    const listed = await env.CACHE.list({ prefix: `daily/${date}/`, cursor });
    if (listed.objects.length > 0) {
      removed += listed.objects.length;
      await Promise.all(listed.objects.map((object) => env.CACHE.delete(object.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return removed;
}

/** 抓今天的最新列表；写入后顺手清掉昨天的目录，实现「有效期仅当天」。 */
export async function buildDaily(env: Env): Promise<DailyIndex> {
  const date = dayKey();
  const limit = dailyLimit(env);
  const seen = new Set<string>();
  const items: DailyItem[] = [];

  // 接口每页 80 条，最多取 3 页，留出充足的子请求余量给同一次调用里的其他操作
  for (let page = 1; items.length < limit && page <= 3; page++) {
    const batch = await fetchLatest(page);
    if (batch.length === 0) break;
    for (const item of batch) {
      if (seen.has(item.album_id)) continue;
      seen.add(item.album_id);
      items.push(item);
    }
  }

  const index: DailyIndex = { date, built_at: Date.now(), items: items.slice(0, limit) };
  await env.CACHE.put(indexKey(date), JSON.stringify(index), {
    httpMetadata: { contentType: 'application/json' },
  });
  await purgeDate(env, dayKey(1));
  return index;
}

export async function readDaily(env: Env): Promise<DailyIndex> {
  const date = dayKey();
  const cached = await readJson<DailyIndex>(env, indexKey(date));
  if (cached && cached.date === date && cached.items?.length > 0) return cached;
  return buildDaily(env);
}

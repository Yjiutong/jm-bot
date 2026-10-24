export interface Env {
  CACHE: R2Bucket;

  QQ_APP_ID: string;
  QQ_CLIENT_SECRET: string;
  QQ_API_BASE?: string;
  QQ_TOKEN_URL?: string;

  LINK_SECRET: string;
  PUBLIC_BASE_URL?: string;
  PREVIEW_HOURS?: string;
  DAILY_LIMIT?: string;
}

export interface AlbumEpisode {
  photo_id: string;
  index: number;
  title: string;
}

export interface AlbumMeta {
  album_id: string;
  title: string;
  authors: string[];
  tags: string[];
  description: string;
  page_count: number;
  pub_date: string;
  views: string;
  scramble_id: string;
  fetched_at: number;
  episodes: AlbumEpisode[];
}

export interface Chapter {
  photo_id: string;
  index: number;
  title: string;
  images: string[];
}

/** 当前 workers-types 的 R2 get 没有 json 泛型重载，统一走这里。 */
export async function readJson<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.CACHE.get(key);
  if (!object?.body) return null;
  try {
    return JSON.parse(await object.text()) as T;
  } catch {
    return null;
  }
}

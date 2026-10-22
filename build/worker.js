// src/crypto.ts
var APP_DATA_SECRET = "185Hcomic3PAPP7R";
function md5hex(str) {
  const bytes = Array.from(new TextEncoder().encode(str));
  const bitLen = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const len = new DataView(new ArrayBuffer(8));
  len.setUint32(0, bitLen >>> 0, true);
  len.setUint32(4, Math.floor(bitLen / 4294967296), true);
  for (let i = 0; i < 8; i++) bytes.push(len.getUint8(i));
  const S = [
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21
  ];
  const K = [];
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  }
  let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
  const add = (x, y) => x + y | 0;
  const rotl = (x, n) => x << n | x >>> 32 - n;
  for (let off = 0; off < bytes.length; off += 64) {
    const M = [];
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4;
      M[j] = bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16 | bytes[p + 3] << 24;
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) {
        f = b & c | ~b & d;
        g = j;
      } else if (j < 32) {
        f = d & b | ~d & c;
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = 7 * j % 16;
      }
      const t = d;
      d = c;
      c = b;
      b = add(b, rotl(add(add(add(a, f), K[j]), M[g]), S[j]));
      a = t;
    }
    a0 = add(a0, a);
    b0 = add(b0, b);
    c0 = add(c0, c);
    d0 = add(d0, d);
  }
  const hexLE = (n) => {
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += ("0" + (n >> i * 8 & 255).toString(16)).slice(-2);
    }
    return out;
  };
  return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
}
function signToken(ts, secret = APP_DATA_SECRET) {
  return md5hex(`${ts}${secret}`);
}
function b64ToBytes(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const padded = clean.length % 4 ? clean + "=".repeat(4 - clean.length % 4) : clean;
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
async function aesEcbDecrypt(cipherBytes, rawKey) {
  if (cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) {
    throw new Error(`\u5BC6\u6587\u957F\u5EA6\u4E0D\u662F 16 \u7684\u500D\u6570: ${cipherBytes.length}`);
  }
  const ZERO = new Uint8Array(16);
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
  const last = cipherBytes.subarray(cipherBytes.length - 16);
  const pad = new Uint8Array(16).fill(16);
  const x = pad.map((v, i) => v ^ last[i]);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: ZERO }, key, x));
  const body = new Uint8Array(cipherBytes.length + 16);
  body.set(cipherBytes);
  body.set(enc.subarray(0, 16), cipherBytes.length);
  const cbc = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: ZERO }, key, body));
  const out = new Uint8Array(cbc.length);
  for (let i = 0; i < cbc.length; i += 16) {
    const prev = i === 0 ? ZERO : cipherBytes.subarray(i - 16, i);
    for (let j = 0; j < 16; j++) out[i + j] = cbc[i + j] ^ prev[j];
  }
  const padLen = out[out.length - 1];
  if (padLen < 1 || padLen > 16) throw new Error(`\u975E\u6CD5 PKCS7 \u586B\u5145\u957F\u5EA6: ${padLen}`);
  return out.subarray(0, out.length - padLen);
}
async function decodeApiData(data, ts) {
  const key = new TextEncoder().encode(signToken(ts));
  const plain = await aesEcbDecrypt(b64ToBytes(data), key);
  return JSON.parse(new TextDecoder().decode(plain));
}

// src/jm.ts
var TOKEN_SECRET = "185Hcomic3PAPP7R";
var TOKEN_SECRET_2 = "18comicAPPContent";
var APP_VERSION = "2.1.7";
var API_HOSTS = ["www.cdnhjk.net", "www.cdngwc.cc", "www.cdngwc.net", "www.cdngwc.club"];
var IMAGE_HOSTS = [
  "cdn-msp.jmapiproxy1.cc",
  "cdn-msp.jmapiproxy2.cc",
  "cdn-msp2.jmapiproxy2.cc",
  "cdn-msp3.jmapiproxy2.cc",
  "cdn-msp.jmapinodeudzn.net",
  "cdn-msp3.jmapinodeudzn.net"
];
var UA = "Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36";
var cookie = "";
var cookieAt = 0;
function apiHeaders(ts, secret = TOKEN_SECRET) {
  return {
    "user-agent": UA,
    "accept-encoding": "gzip, deflate",
    token: signToken(ts, secret),
    tokenparam: `${ts},${APP_VERSION}`
  };
}
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
async function settingCookie() {
  if (cookie && Date.now() - cookieAt < 36e5) return cookie;
  const ts = Math.floor(Date.now() / 1e3);
  for (const host of API_HOSTS) {
    try {
      const resp = await fetch(`https://${host}/setting`, { headers: apiHeaders(ts) });
      const value = (resp.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      if (resp.status === 200 && value) {
        cookie = value;
        cookieAt = Date.now();
        return cookie;
      }
    } catch {
    }
  }
  return cookie;
}
async function apiData(path) {
  const ts = Math.floor(Date.now() / 1e3);
  const headers = { ...apiHeaders(ts) };
  const c = await settingCookie();
  if (c) headers.cookie = c;
  const fails = [];
  for (const host of API_HOSTS) {
    try {
      const resp = await fetch(`https://${host}${path}`, { headers });
      if (resp.status !== 200) {
        fails.push(`${host}=${resp.status}`);
        continue;
      }
      const envelope = await resp.json();
      if (typeof envelope.data === "string") return await decodeApiData(envelope.data, ts);
      if (envelope.data && typeof envelope.data === "object") return envelope.data;
      fails.push(`${host}=\u7A7Adata`);
    } catch (e) {
      fails.push(`${host}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`\u7981\u6F2B\u63A5\u53E3\u5168\u90E8\u5931\u8D25 ${path} \u2192 ${fails.join(" | ")}`);
}
async function fetchScrambleId(photoId) {
  const ts = Math.floor(Date.now() / 1e3);
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
    }
  }
  return "220980";
}
async function fetchAlbum(albumId) {
  const data = await apiData(`/album?id=${albumId}&lang=zh`);
  const series = data.series ?? [];
  let episodes = series.map((s) => ({
    photo_id: String(s.id),
    index: Number(s.sort),
    title: String(s.name ?? "")
  }));
  episodes.sort((a, b) => a.index - b.index);
  if (episodes.length === 0) episodes = [{ photo_id: albumId, index: 1, title: String(data.name ?? "") }];
  return {
    album_id: String(data.id ?? albumId),
    title: String(data.name ?? ""),
    authors: (data.author ?? []).map(String),
    tags: (data.tags ?? []).map(String),
    description: String(data.description ?? ""),
    page_count: Number(data.total_photos ?? 0),
    pub_date: data.addtime ? new Date(Number(data.addtime) * 1e3).toISOString().slice(0, 10) : "",
    views: String(data.total_views ?? ""),
    scramble_id: await fetchScrambleId(episodes[0].photo_id),
    fetched_at: Date.now(),
    episodes
  };
}
async function fetchChapter(meta, photoId) {
  const data = await apiData(`/chapter?id=${photoId}&lang=zh`);
  const series = data.series ?? [];
  const self = series.find((s) => String(s.id) === photoId);
  const known = meta.episodes.find((e) => e.photo_id === photoId);
  return {
    photo_id: photoId,
    index: self ? Number(self.sort) : known?.index ?? 1,
    title: known?.title || String(data.name ?? ""),
    images: (data.images ?? []).map(String),
    domain: pick(IMAGE_HOSTS)
  };
}
function imageNum(scrambleId, photoId, fileName) {
  const sid = Number(scrambleId);
  const aid = Number(photoId);
  if (aid < sid) return 0;
  if (aid < 268850) return 10;
  const x = aid < 421926 ? 10 : 8;
  const hex = md5hex(`${photoId}${fileName}`);
  return hex.charCodeAt(hex.length - 1) % x * 2 + 2;
}
function imageUrl(domain, photoId, fileName) {
  return `https://${domain}/media/photos/${photoId}/${fileName}`;
}
async function fetchImageBytes(url) {
  const resp = await fetch(url, {
    headers: {
      "user-agent": UA,
      referer: "https://18comic.vip/",
      "x-requested-with": "com.JMComic3.app"
    }
  });
  if (!resp.ok || resp.status !== 200) throw new Error(`\u56FE\u7247\u83B7\u53D6\u5931\u8D25 ${resp.status}: ${url}`);
  const bytes = await resp.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error(`\u56FE\u7247\u54CD\u5E94\u4E3A\u7A7A: ${url}`);
  return { bytes, contentType: resp.headers.get("content-type") ?? "image/jpeg" };
}

// src/reader.ts
function esc(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
var STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#111;color:#ddd;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:14px 16px;border-bottom:1px solid #2a2a2a}
h1{margin:0 0 6px;font-size:19px;line-height:1.35}
.meta{color:#9a9a9a;font-size:13px}
.tag{display:inline-block;margin:4px 6px 0 0;padding:1px 7px;border:1px solid #333;border-radius:3px;font-size:12px;color:#bbb}
nav{position:sticky;top:0;z-index:2;display:flex;gap:8px;overflow-x:auto;padding:9px 16px;background:#161616;border-bottom:1px solid #2a2a2a;white-space:nowrap}
nav a{padding:4px 10px;border:1px solid #333;border-radius:4px;color:#ccc;font-size:13px;text-decoration:none}
nav a.on{background:#2d2d2d;border-color:#555;color:#fff}
main{max-width:820px;margin:0 auto;padding:10px 4px 60px}
main img{display:block;width:100%;height:auto;margin:0 auto 2px;background:#1c1c1c}
footer{padding:16px;color:#777;font-size:12px;text-align:center}
`.trim();
var SCRIPT = `
const seen = new WeakSet();
function restore(img) {
  const num = Number(img.dataset.num || 0);
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!num || !w || !h) return;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const over = h % num, base = Math.floor(h / num);
  for (let i = 0; i < num; i++) {
    let move = base;
    const ySrc = h - base * (i + 1) - over;
    let yDst = base * i;
    if (i === 0) move += over; else yDst += over;
    ctx.drawImage(img, 0, ySrc, w, move, 0, yDst, w, move);
  }
  canvas.toBlob((blob) => {
    if (!blob) return;
    img.onload = null;
    img.src = URL.createObjectURL(blob);
  }, 'image/jpeg', 0.92);
}
const io = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    io.unobserve(img);
    if (img.complete) restore(img);
    else img.addEventListener('load', () => restore(img), { once: true });
  }
}, { rootMargin: '600px 0px' });
document.querySelectorAll('main img').forEach((img) => io.observe(img));
`;
function renderReader(meta, chapter, options) {
  const query = `e=${encodeURIComponent(options.exp)}&s=${encodeURIComponent(options.sig)}`;
  const total = meta.episodes.length;
  const index = Math.min(Math.max(options.chapterIndex, 0), total - 1);
  const nav = meta.episodes.map(
    (e, i) => `<a class="${i === index ? "on" : ""}" href="?ep=${i}&${query}">${i + 1}. ${esc(e.title || `\u7B2C${i + 1}\u8BDD`)}</a>`
  ).join("");
  const pages = chapter.images.map((name, i) => {
    const num = options.nums[i] ?? 0;
    return `<img src="/i/${meta.album_id}/${chapter.photo_id}/${encodeURIComponent(name)}?${query}" data-num="${num}" loading="lazy" decoding="async" alt="\u7B2C ${i + 1} \u9875">`;
  }).join("\n");
  const tags = meta.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(meta.title)} - ${index + 1}/${total}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>${esc(meta.title)}</h1>
  <div class="meta">${esc(meta.authors.join(" / "))}\uFF5C${meta.episodes.length} \u8BDD ${meta.page_count} \u9875\uFF5C${esc(meta.pub_date)}</div>
  <div>${tags}</div>
</header>
<nav>${nav}</nav>
<main>
${pages}
</main>
<footer>\u7B2C ${index + 1} \u8BDD\uFF0C\u5171 ${total} \u8BDD\u3002\u6B64\u94FE\u63A5\u7EA6 ${options.ttlHours} \u5C0F\u65F6\u540E\u5931\u6548\u3002</footer>
<script>${SCRIPT}<\/script>
</body>
</html>`;
}

// src/env.ts
async function readJson(env, key) {
  const object = await env.CACHE.get(key);
  if (!object?.body) return null;
  try {
    return JSON.parse(await object.text());
  } catch {
    return null;
  }
}

// src/qq.ts
var PKCS8_ED25519 = Uint8Array.from([
  48,
  46,
  2,
  1,
  0,
  48,
  5,
  6,
  3,
  43,
  101,
  112,
  4,
  34,
  4,
  32
]);
var DEFAULT_API_BASE = "https://api.bot.qq.com";
var DEFAULT_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
var verifyKey = null;
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signingKey(env) {
  const seed = new TextEncoder().encode(env.QQ_CLIENT_SECRET).subarray(0, 32);
  const der = new Uint8Array(PKCS8_ED25519.length + 32);
  der.set(PKCS8_ED25519);
  der.set(seed, PKCS8_ED25519.length);
  return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
}
async function publicVerifyKey(env) {
  if (verifyKey) return verifyKey;
  const key = await signingKey(env);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  verifyKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  return verifyKey;
}
async function signCallback(env, eventTs, plainToken) {
  const key = await signingKey(env);
  return toHex(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${eventTs}${plainToken}`)));
}
async function verifyCallback(env, signature, timestamp, body) {
  try {
    const key = await publicVerifyKey(env);
    const raw = Uint8Array.from(signature.match(/../g) ?? [], (h) => parseInt(h, 16));
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      raw,
      new TextEncoder().encode(`${timestamp}${body}`)
    );
  } catch {
    return false;
  }
}
async function accessToken(env) {
  const key = "state/qq-token.json";
  const cached = await readJson(env, key);
  if (cached?.token && cached.expiresAt - Date.now() > 6e4) return cached.token;
  const resp = await fetch(env.QQ_TOKEN_URL || DEFAULT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: env.QQ_APP_ID, client_secret: env.QQ_CLIENT_SECRET })
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`\u83B7\u53D6 access_token \u5931\u8D25: ${JSON.stringify(data).slice(0, 200)}`);
  await env.CACHE.put(
    key,
    JSON.stringify({ token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 7200) * 1e3 }),
    { httpMetadata: { contentType: "application/json" } }
  );
  return data.access_token;
}
async function reply(env, event, text) {
  if (!event.id) return "\u4E8B\u4EF6\u7F3A\u5C11 id\uFF0C\u65E0\u6CD5\u88AB\u52A8\u56DE\u590D";
  const target = event.group_openid ? `/v2/groups/${event.group_openid}/messages` : event.openid ? `/v2/users/${event.openid}/messages` : "";
  if (!target) return "\u4E8B\u4EF6\u91CC\u6CA1\u6709 group_openid / openid";
  const resp = await fetch(`${env.QQ_API_BASE || DEFAULT_API_BASE}${target}`, {
    method: "POST",
    headers: {
      authorization: `QQBot ${await accessToken(env)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      msgtype: 0,
      content: text.slice(0, 500),
      msg_id: event.id,
      msg_seq: Date.now()
    })
  });
  const body = await resp.text();
  return resp.ok ? `\u5DF2\u56DE\u590D: ${body.slice(0, 120)}` : `\u56DE\u590D\u5931\u8D25 ${resp.status}: ${body.slice(0, 200)}`;
}

// src/index.ts
var ID = /^\d{4,12}$/;
var NAME = /^[\w.-]+\.(jpg|jpeg|png|gif|webp)$/i;
var DEFAULT_PREVIEW_HOURS = "24";
function reason(e) {
  return e instanceof Error ? e.message : String(e);
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function previewHours(env) {
  return Math.max(1, Number(env.PREVIEW_HOURS ?? DEFAULT_PREVIEW_HOURS));
}
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function linkSig(env, albumId, exp) {
  return hmac(env.LINK_SECRET ?? "", `${albumId}:${exp}`);
}
async function previewLink(env, albumId, baseUrl) {
  const exp = Math.floor(Date.now() / 1e3) + previewHours(env) * 3600;
  const sig = await linkSig(env, albumId, String(exp));
  return `${baseUrl}/p/${albumId}?e=${exp}&s=${sig}`;
}
async function checkAccess(env, albumId, params) {
  const exp = params.get("e") ?? "";
  const sig = params.get("s") ?? "";
  if (!/^\d+$/.test(exp)) return "\u7F3A\u5C11\u8FC7\u671F\u53C2\u6570";
  if (Number(exp) * 1e3 < Date.now()) return "\u94FE\u63A5\u5DF2\u8FC7\u671F";
  if (sig !== await linkSig(env, albumId, exp)) return "\u7B7E\u540D\u4E0D\u5339\u914D";
  return null;
}
async function ensureMeta(env, albumId) {
  const key = `albums/${albumId}/meta.json`;
  const cached = await readJson(env, key);
  if (cached?.album_id) return cached;
  const meta = await fetchAlbum(albumId);
  await env.CACHE.put(key, JSON.stringify(meta), { httpMetadata: { contentType: "application/json" } });
  return meta;
}
async function ensureChapter(env, meta, photoId) {
  const key = `albums/${meta.album_id}/chapter/${photoId}.json`;
  const cached = await readJson(env, key);
  if (cached?.photo_id) return cached;
  const chapter = await fetchChapter(meta, photoId);
  await env.CACHE.put(key, JSON.stringify(chapter), { httpMetadata: { contentType: "application/json" } });
  return chapter;
}
async function serveImage(env, key, source) {
  const cached = await env.CACHE.get(key);
  if (cached) {
    return new Response(cached.body, {
      headers: {
        "content-type": cached.httpMetadata?.contentType ?? "application/octet-stream",
        "cache-control": "private, max-age=3600"
      }
    });
  }
  const image = await fetchImageBytes(source);
  await env.CACHE.put(key, image.bytes, { httpMetadata: { contentType: image.contentType } });
  return new Response(image.bytes, {
    headers: { "content-type": image.contentType, "cache-control": "private, max-age=3600" }
  });
}
function stripSuffix(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}
function parseAlbumId(content) {
  const cleaned = content.replace(/@[^\s]+/g, " ").trim();
  return /^\d{4,12}$/.test(cleaned) ? cleaned : "";
}
function resolveBaseUrl(env, request) {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}
async function handleQqEvent(env, event, baseUrl) {
  const albumId = parseAlbumId(event.content ?? "");
  if (!albumId) return await reply(env, event, "\u7528\u6CD5\uFF1A\u76F4\u63A5\u53D1\u4E00\u4E2A\u7981\u6F2B JM \u53F7\uFF0C\u4F8B\u5982 350234");
  try {
    const meta = await ensureMeta(env, albumId);
    const link = await previewLink(env, meta.album_id, baseUrl);
    const lines = [
      meta.title,
      `${meta.authors.join(" / ")}\uFF5C${meta.episodes.length} \u8BDD ${meta.page_count} \u9875`,
      meta.tags.length > 0 ? `\u6807\u7B7E ${meta.tags.slice(0, 6).join(" ")}` : "",
      link
    ].filter(Boolean);
    return await reply(env, event, lines.join("\n"));
  } catch (e) {
    return await reply(env, event, `\u6293\u53D6\u5931\u8D25\uFF1A${reason(e)}`.slice(0, 400));
  }
}
async function cryptoSelfTest(env) {
  const result = {};
  try {
    const sig = await signCallback(env, "1725442341", "Arq0D5A61EgUu4OxUvOp");
    result.ed25519_sign = `ok (${sig.length} hex)`;
    result.ed25519_verify = await verifyCallback(env, sig, "1725442341", "Arq0D5A61EgUu4OxUvOp") ? "ok" : "FAILED";
  } catch (e) {
    result.ed25519 = `FAILED: ${reason(e)}`;
  }
  try {
    await env.CACHE.put("state/selftest.txt", "ok");
    result.r2 = (await env.CACHE.get("state/selftest.txt"))?.body ? "ok" : "read failed";
  } catch (e) {
    result.r2 = `FAILED: ${reason(e)}`;
  }
  return json(result);
}
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const seg = url.pathname.split("/").filter(Boolean);
    try {
      if (seg.length === 0) {
        return new Response("jm-bot worker\uFF1A/p/<JM\u53F7> \u9605\u8BFB\u9875\uFF0C/qq/callback \u56DE\u8C03\uFF0C/cryptotest \u81EA\u68C0", {
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      if (seg[0] === "cryptotest") return await cryptoSelfTest(env);
      if (seg[0] === "qq" && seg[1] === "callback") {
        if (request.method !== "POST") return new Response("POST only", { status: 405 });
        const body = await request.text();
        const payload = JSON.parse(body);
        const signature = request.headers.get("x-signature-ed25519") ?? "";
        const timestamp = request.headers.get("x-signature-timestamp") ?? "";
        if (!signature) return new Response("missing signature", { status: 401 });
        if (payload.op === 13) {
          const d = payload.d ?? {};
          return json({
            plain_token: d.plain_token,
            signature: await signCallback(env, d.event_ts ?? "", d.plain_token ?? "")
          });
        }
        if (!await verifyCallback(env, signature, timestamp, body)) {
          return new Response("invalid signature", { status: 401 });
        }
        ctx.waitUntil(handleQqEvent(env, payload.d ?? {}, resolveBaseUrl(env, request)).then((log) => console.log(log)));
        return json({ op: 12 });
      }
      if (seg[0] === "p" && seg.length === 2 && ID.test(seg[1])) {
        const albumId = seg[1];
        const denied = await checkAccess(env, albumId, url.searchParams);
        if (denied) return new Response(denied, { status: 403 });
        const meta = await ensureMeta(env, albumId);
        const index = Math.min(Math.max(Number(url.searchParams.get("ep") ?? "0") || 0, 0), meta.episodes.length - 1);
        const episode = meta.episodes[index];
        const chapter = await ensureChapter(env, meta, episode.photo_id);
        const query = url.searchParams;
        const nums = chapter.images.map(
          (name) => name.toLowerCase().endsWith(".gif") ? 0 : imageNum(meta.scramble_id, chapter.photo_id, stripSuffix(name)) || 0
        );
        return new Response(
          renderReader(meta, chapter, {
            chapterIndex: index,
            nums,
            exp: query.get("e") ?? "",
            sig: query.get("s") ?? "",
            ttlHours: previewHours(env)
          }),
          { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
        );
      }
      if (seg[0] === "i" && seg.length === 4 && ID.test(seg[1]) && ID.test(seg[2]) && NAME.test(seg[3])) {
        const albumId = seg[1];
        const photoId = seg[2];
        const fileName = decodeURIComponent(seg[3]);
        const denied = await checkAccess(env, albumId, url.searchParams);
        if (denied) return new Response(denied, { status: 403 });
        const meta = await ensureMeta(env, albumId);
        const chapter = await ensureChapter(env, meta, photoId);
        if (!chapter.images.includes(fileName)) return new Response("not found", { status: 404 });
        return serveImage(
          env,
          `albums/${albumId}/img/${photoId}/${fileName}`,
          imageUrl(chapter.domain, photoId, fileName)
        );
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      return new Response(`\u8BF7\u6C42\u5931\u8D25: ${reason(e)}`, { status: 502 });
    }
  }
};
export {
  index_default as default
};

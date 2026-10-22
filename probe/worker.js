// 免费计划可行性探针 Worker。
// 目的：确认 Cloudflare 出口能否直连禁漫移动端 API（不依赖 curl_cffi 指纹伪装）。
//
// 用法：dash.cloudflare.com → Workers & Pages → Create application → Single file
//       把本文件内容整段粘贴进去 → Deploy → 访问
//       https://<你的worker>.workers.dev/probe?album=350234

const TOKEN_SECRET = '185Hcomic3PAPP7R';
const TOKEN_SECRET_2 = '18comicAPPContent';
const APP_VERSION = '2.1.7';
const API_HOSTS = ['www.cdnhjk.net', 'www.cdngwc.cc', 'www.cdngwc.net', 'www.cdngwc.club'];
const UA =
  'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36';

/** 纯 JS MD5：Workers 的 WebCrypto 不提供 MD5，而签名与图片乱序分割数都依赖它。 */
export function md5hex(str) {
  const bytes = Array.from(new TextEncoder().encode(str));
  const bitLen = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const len = new DataView(new ArrayBuffer(8));
  len.setUint32(0, bitLen >>> 0, true);
  len.setUint32(4, Math.floor(bitLen / 4294967296), true);
  for (let i = 0; i < 8; i++) bytes.push(len.getUint8(i));

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [];
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const add = (x, y) => (x + y) | 0;
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    const M = [];
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4;
      M[j] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
    }

    let a = a0, b = b0, c = c0, d = d0;
    for (let j = 0; j < 64; j++) {
      let f, g;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      b = add(b, rotl(add(add(add(a, f), K[j]), M[g]), S[j]));
      a = tmp;
    }

    a0 = add(a0, a);
    b0 = add(b0, b);
    c0 = add(c0, c);
    d0 = add(d0, d);
  }

  const hexLE = (n) => {
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += ('0' + ((n >> (i * 8)) & 0xff).toString(16)).slice(-2);
    }
    return out;
  };
  return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
}

function signedHeaders(ts, secret = TOKEN_SECRET) {
  return {
    'user-agent': UA,
    'accept-encoding': 'gzip, deflate',
    token: md5hex(`${ts}${secret}`),
    tokenparam: `${ts},${APP_VERSION}`,
  };
}

/**
 * 只用 WebCrypto 的 AES-CBC 还原 AES-ECB 解密。
 * WebCrypto 没有 ECB 且强制剥 PKCS7，所以附加一个密文块把剥离动作引开，
 * 再手工剥掉 ECB 明文里真实的填充。
 */
async function aesEcbDecrypt(cipherBytes, rawKey) {
  const ZERO = new Uint8Array(16);
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);

  const last = cipherBytes.subarray(cipherBytes.length - 16);
  const pad = new Uint8Array(16).fill(0x10);
  const x = pad.map((v, i) => v ^ last[i]);
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: ZERO }, key, x));

  const body = new Uint8Array(cipherBytes.length + 16);
  body.set(cipherBytes);
  body.set(enc.subarray(0, 16), cipherBytes.length);

  const cbc = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ZERO }, key, body));

  const out = new Uint8Array(cbc.length);
  for (let i = 0; i < cbc.length; i += 16) {
    const prev = i === 0 ? ZERO : cipherBytes.subarray(i - 16, i);
    for (let j = 0; j < 16; j++) out[i + j] = cbc[i + j] ^ prev[j];
  }

  const padLen = out[out.length - 1];
  if (padLen < 1 || padLen > 16) throw new Error(`非法 PKCS7 填充: ${padLen}`);
  return out.subarray(0, out.length - padLen);
}

function b64ToBytes(text) {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(clean.length % 4 ? clean + '='.repeat(4 - (clean.length % 4)) : clean);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function decodeApiData(data, ts) {
  const key = new TextEncoder().encode(md5hex(`${ts}${TOKEN_SECRET}`));
  const plain = await aesEcbDecrypt(b64ToBytes(data), key);
  return JSON.parse(new TextDecoder().decode(plain));
}

async function probe(host, albumId, ts) {
  const out = { host };
  const base = `https://${host}`;

  const setting = await fetch(`${base}/setting`, { headers: signedHeaders(ts) });
  const raw = setting.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');
  out.setting = { status: setting.status, cookie_names: cookie.split('; ').filter(Boolean) };

  const headers = { ...signedHeaders(ts) };
  if (cookie) headers.cookie = cookie;

  const album = await fetch(`${base}/album?id=${albumId}&lang=zh`, { headers });
  const text = await album.text();
  out.album = { status: album.status, bytes: text.length, head: text.slice(0, 60) };

  if (album.status === 200) {
    try {
      const envelope = JSON.parse(text);
      if (typeof envelope.data === 'string') {
        const parsed = await decodeApiData(envelope.data, ts);
        out.decoded = { name: parsed.name, series: parsed.series.length, tags: (parsed.tags || []).length };
      } else {
        out.decoded = { note: 'data 不是密文字符串', shape: Object.keys(envelope.data || {}).slice(0, 8) };
      }
    } catch (e) {
      out.decoded = { error: String(e) };
    }
  }

  const scramble = await fetch(
    `${base}/chapter_view_template?id=${albumId}&mode=vertical&page=0&app_img_shunt=1&express=off&v=${ts}`,
    { headers: { ...signedHeaders(ts, TOKEN_SECRET_2), ...(cookie ? { cookie } : {}) } },
  );
  out.scramble = { status: scramble.status, has_scramble_id: (await scramble.text()).includes('scramble_id') };

  return out;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/probe') {
      return new Response('访问 /probe?album=350234');
    }
    const albumId = (url.searchParams.get('album') || '350234').replace(/\D/g, '');
    const ts = Math.floor(Date.now() / 1000);
    const report = { ts, album_id: albumId, hosts: [] };

    for (const host of API_HOSTS) {
      try {
        const step = await probe(host, albumId, ts);
        report.hosts.push(step);
        if (step.album?.status === 200) break;
      } catch (e) {
        report.hosts.push({ host, error: String(e) });
      }
    }

    try {
      const img = await fetch('https://cdn-msp3.jmapinodeudzn.net/media/albums/350234.jpg', {
        headers: { 'user-agent': UA, referer: 'https://18comic.vip/' },
      });
      report.cover = { status: img.status, bytes: (await img.arrayBuffer()).byteLength };
    } catch (e) {
      report.cover = { error: String(e) };
    }

    return new Response(JSON.stringify(report, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};

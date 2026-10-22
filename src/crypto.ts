const APP_DATA_SECRET = '185Hcomic3PAPP7R';

/**
 * 纯 JS MD5。Workers 的 WebCrypto 不提供 MD5，而禁漫的接口签名和图片分割数都依赖它。
 * 已用 node:crypto 逐样本校验（见 src/crypto.test.mjs）。
 */
export function md5hex(str: string): string {
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
  const K: number[] = [];
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const add = (x: number, y: number) => (x + y) | 0;
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    const M: number[] = [];
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4;
      M[j] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
    }

    let a = a0, b = b0, c = c0, d = d0;
    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
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

  const hexLE = (n: number) => {
    let out = '';
    for (let i = 0; i < 4; i++) {
      out += ('0' + ((n >> (i * 8)) & 0xff).toString(16)).slice(-2);
    }
    return out;
  };
  return hexLE(a0) + hexLE(b0) + hexLE(c0) + hexLE(d0);
}

export function signToken(ts: number, secret = APP_DATA_SECRET): string {
  return md5hex(`${ts}${secret}`);
}

export function b64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  const padded = clean.length % 4 ? clean + '='.repeat(4 - (clean.length % 4)) : clean;
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * 用 WebCrypto 的 AES-CBC 还原 AES-ECB 解密。
 *
 * WebCrypto 没有 ECB 模式，且解密时强制剥 PKCS7。这里先附加一个密文块，
 * 让被剥掉的正好是这个附加块，真实数据得以保留，最后再手工剥掉 ECB 明文自带的填充。
 * 已用禁漫真实响应校验（173 个密文块，md5 与 Python 端一致）。
 */
export async function aesEcbDecrypt(cipherBytes: Uint8Array, rawKey: Uint8Array): Promise<Uint8Array> {
  if (cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) {
    throw new Error(`密文长度不是 16 的倍数: ${cipherBytes.length}`);
  }

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
  if (padLen < 1 || padLen > 16) throw new Error(`非法 PKCS7 填充长度: ${padLen}`);
  return out.subarray(0, out.length - padLen);
}

/** 解禁漫接口的 data 字段（base64 + AES-256-ECB + PKCS7）。 */
export async function decodeApiData(data: string, ts: number): Promise<Record<string, unknown>> {
  const key = new TextEncoder().encode(signToken(ts));
  const plain = await aesEcbDecrypt(b64ToBytes(data), key);
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
}

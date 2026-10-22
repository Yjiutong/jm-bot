import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { md5hex, aesEcbDecrypt, b64ToBytes, signToken } from './crypto.ts';

let bad = 0;
for (const s of ['', 'a', 'abc', '1700566805185Hcomic3PAPP7R', '35023400002', '中文测试', 'x'.repeat(55), 'y'.repeat(64), 'z'.repeat(119)]) {
  const expect = createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');
  if (expect !== md5hex(s)) {
    bad++;
    console.log(`FAIL md5 ${JSON.stringify(s)}`);
  }
}
console.log(bad === 0 ? 'md5: PASS' : `md5: ${bad} 个不匹配`);

const fixture = '../probe/sample_enc.json';
if (!existsSync(new URL(fixture, import.meta.url))) {
  console.log('ECB: SKIP（缺 probe/sample_enc.json 样本，用 jmcomic 抓一次真实响应即可生成）');
  process.exit(bad === 0 ? 0 : 1);
}

const sample = JSON.parse(readFileSync(new URL(fixture, import.meta.url), 'utf8'));
const key = new TextEncoder().encode(signToken(sample.ts));
const plain = await aesEcbDecrypt(b64ToBytes(sample.encoded), key);
const got = createHash('md5').update(plain).digest('hex');
console.log(`ECB: ${got === sample.decoded_md5 ? 'PASS' : 'FAIL'} (${plain.length} 字节, 期望 ${sample.decoded_md5}, 实际 ${got})`);
process.exit(bad === 0 && got === sample.decoded_md5 ? 0 : 1);

import type { AlbumMeta, Chapter } from './env';

function esc(text: string): string {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const STYLE = `
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

/** 图片是横向切条乱序的，还原只能在浏览器里做，Worker 碰大图必然超 CPU 额度。 */
const SCRIPT = `
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

export interface ReaderOptions {
  chapterIndex: number;
  nums: number[];
  exp: string;
  sig: string;
  ttlHours: number;
}

export function renderReader(meta: AlbumMeta, chapter: Chapter, options: ReaderOptions): string {
  const query = `e=${encodeURIComponent(options.exp)}&s=${encodeURIComponent(options.sig)}`;
  const total = meta.episodes.length;
  const index = Math.min(Math.max(options.chapterIndex, 0), total - 1);

  const nav = meta.episodes
    .map(
      (e, i) =>
        `<a class="${i === index ? 'on' : ''}" href="?ep=${i}&${query}">${i + 1}. ${esc(e.title || `第${i + 1}话`)}</a>`,
    )
    .join('');

  const pages = chapter.images
    .map((name, i) => {
      const num = options.nums[i] ?? 0;
      return `<img src="/i/${meta.album_id}/${chapter.photo_id}/${encodeURIComponent(name)}?${query}" data-num="${num}" loading="lazy" decoding="async" alt="第 ${i + 1} 页">`;
    })
    .join('\n');

  const tags = meta.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('');

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
  <div class="meta">${esc(meta.authors.join(' / '))}｜${meta.episodes.length} 话 ${meta.page_count} 页｜${esc(meta.pub_date)}</div>
  <div>${tags}</div>
</header>
<nav>${nav}</nav>
<main>
${pages}
</main>
<footer>第 ${index + 1} 话，共 ${total} 话。此链接约 ${options.ttlHours} 小时后失效。</footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

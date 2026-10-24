import type { AlbumMeta, Chapter } from './env';
import { esc } from './shelf';
import { doc, header } from './theme';

/** 图片是横向切条乱序的，还原只能在浏览器里做，Worker 碰大图必然超 CPU 额度。 */
const RESTORE = `
var seen = new WeakSet();
function restore(img){
  if (seen.has(img)) return;
  seen.add(img);
  var num = Number(img.dataset.num || 0);
  var w = img.naturalWidth, h = img.naturalHeight;
  if (!num || !w || !h) return;
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  var over = h % num, base = Math.floor(h / num);
  for (var i = 0; i < num; i++){
    var move = base;
    var ySrc = h - base * (i + 1) - over;
    var yDst = base * i;
    if (i === 0) move += over; else yDst += over;
    ctx.drawImage(img, 0, ySrc, w, move, 0, yDst, w, move);
  }
  canvas.toBlob(function(blob){
    if (!blob) return;
    img.onload = null;
    img.src = URL.createObjectURL(blob);
  }, 'image/jpeg', 0.92);
}
var io = new IntersectionObserver(function(entries){
  entries.forEach(function(entry){
    if (!entry.isIntersecting) return;
    var img = entry.target;
    io.unobserve(img);
    if (img.complete) restore(img);
    else img.addEventListener('load', function(){ restore(img); }, { once: true });
  });
}, { rootMargin: '700px 0px' });
document.querySelectorAll('.rd-main img').forEach(function(img){ io.observe(img); });
`;

export interface ReaderOptions {
  chapterIndex: number;
  nums: number[];
  /** 已编码好的签名参数串，形如 `e=123&s=abc`，不含前导符号；所有子资源都要带上 */
  query: string;
  ttlHours: number;
}

export function renderReader(meta: AlbumMeta, chapter: Chapter, options: ReaderOptions): string {
  const total = meta.episodes.length;
  if (total === 0) return doc(meta.title, `${header('禁漫试读', 'read')}<main class="ed-wrap"><p>该本子没有可阅读的章节</p></main>`);

  const index = Math.min(Math.max(options.chapterIndex, 0), total - 1);
  const query = options.query;

  const bar = meta.episodes
    .map(
      (e, i) =>
        `<a class="${i === index ? 'on' : ''}" href="?ep=${i}&${query}">${i + 1}. ${esc(e.title || `第${i + 1}话`)}</a>`,
    )
    .join('');

  const pages = chapter.images
    .map(
      (name, i) =>
        `<img src="/i/${meta.album_id}/${chapter.photo_id}/${encodeURIComponent(name)}?${query}" data-num="${options.nums[i] ?? 0}" loading="lazy" decoding="async" alt="第 ${i + 1} 页">`,
    )
    .join('\n');

  const tags = meta.tags.slice(0, 8).join(' · ');

  const body = `${header('禁漫试读', 'read')}
<nav class="rd-bar" aria-label="章节">${bar}</nav>
<div class="ed-body"><main class="ed-wrap">
  <section class="ed-masthead">
    <p class="ed-kicker">Album ${esc(meta.album_id)} · 第 ${index + 1} / ${total} 话</p>
    <h1><span>${esc(meta.title)}</span></h1>
    <p class="ed-lead">${esc(meta.authors.join(' / '))}｜${meta.episodes.length} 话 ${meta.page_count} 页｜发布于 ${esc(meta.pub_date || '未知')}</p>
    ${tags ? `<div class="ed-facts"><div><b>${esc(tags)}</b><span>标签</span></div></div>` : ''}
  </section>
  <section class="rd-main">
${pages}
    <p class="rd-note">第 ${index + 1} 话 · 共 ${total} 话 · 本页约 ${options.ttlHours} 小时后失效</p>
  </section>
</main>
<footer class="ed-foot">仅供个人技术研究与学习使用 · 内容版权归原作者与源站所有</footer>
</div>
<script>${RESTORE}</script>`;

  return doc(`${meta.title} · 第 ${index + 1}/${total} 话`, body);
}
